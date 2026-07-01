import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { User } from 'src/schemas/user/user.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ProfileContactsResponseDto } from './dto/profile-contacts-response.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { InviteStateMemberDto } from './dto/invite-state-member.dto';
import { UpdatePermissionOverridesDto } from './dto/update-permission-overrides.dto';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { StateMemberResponseDto } from './dto/state-member-response.dto';
import { UpdateXviFcSubroleDto } from './dto/update-xvi-fc-subrole.dto';
import { TransferSubmitterDto } from './dto/transfer-submitter.dto';

// ─── Permission-matrix display types ────────────────────────────────────────

export interface PermissionMatrixRow {
  label: string;
  permissionKey: Permission;
  admin: boolean;
  reviewer: boolean;
  viewer: boolean;
}

const STATE_MATRIX: PermissionMatrixRow[] = [
  {
    label: 'View status and reports',
    permissionKey: Permission.VIEW_STATUS_REPORTS,
    admin: true,
    reviewer: true,
    viewer: true,
  },
  { label: 'View dashboards', permissionKey: Permission.VIEW_DASHBOARDS, admin: true, reviewer: true, viewer: true },
  {
    label: 'Upload state-level documents',
    permissionKey: Permission.UPLOAD_STATE_LEVEL_DOCUMENTS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Review ULB submissions',
    permissionKey: Permission.REVIEW_ULB_SUBMISSIONS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  { label: 'Message users', permissionKey: Permission.MESSAGE_USERS, admin: true, reviewer: true, viewer: false },
  {
    label: 'Approve ULB submissions',
    permissionKey: Permission.APPROVE_ULB_SUBMISSIONS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Prepare grant letters',
    permissionKey: Permission.PREPARE_GRANT_LETTERS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Recommend exemptions',
    permissionKey: Permission.RECOMMEND_EXEMPTIONS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Final submit to MoHUA',
    permissionKey: Permission.FINAL_SUBMIT_TO_MOHUA,
    admin: true,
    reviewer: false,
    viewer: false,
  },
  { label: 'Manage users', permissionKey: Permission.MANAGE_USERS, admin: true, reviewer: false, viewer: false },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  private static readonly SAVE_TOKEN_TTL = 120; // 2 minutes — consumed on first use
  private saveTokenKey = (userId: string) => `profile_save_token:${userId}`;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(State.name) private stateModel: Model<StateDocument>,
    private readonly redisService: RedisService,
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService,
  ) {}

  async issueProfileSaveToken(userId: string): Promise<{ token: string }> {
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid user ID');
    const user = await this.userModel.findById(userId).select('_id').lean().exec();
    if (!user) throw new NotFoundException('User not found');
    const token = randomBytes(32).toString('hex');
    await this.redisService.set(this.saveTokenKey(userId), token, UsersService.SAVE_TOKEN_TTL);
    return { token };
  }

  async create(data: Partial<User>): Promise<User> {
    const user = new this.userModel(data);
    return user.save();
  }

  async createManagedUser(dto: CreateManagedUserDto, creator: AuthUser): Promise<Record<string, unknown>> {
    const mobileExists = await this.userModel.exists({ mobile: dto.mobile, isDeleted: false });
    if (mobileExists) {
      throw new BadRequestException('Mobile number already registered');
    }

    const createPayload: Record<string, unknown> = {
      name: dto.name,
      username: dto.username,
      ...(dto.email && { email: dto.email }),
      mobile: dto.mobile,
      role: dto.role,
      designation: dto.designation ?? '',
      status: dto.status ?? 'PENDING',
      password: 'UNSET',
      isActive: false,
      isXVIFCProfileVerified: false,
    };

    const user = await this.userModel.create(createPayload);
    const obj = user.toObject() as unknown as Record<string, unknown>;
    delete obj.password;
    delete obj.refreshTokenHash;
    return obj;
  }

  async inviteStateMember(dto: InviteStateMemberDto, requester: AuthUser): Promise<StateMemberResponseDto> {
    if (!requester.state) throw new ForbiddenException('No state scope on this account');

    const action = dto.action ?? 'invite';
    const stateId = new Types.ObjectId(String(requester.state));
    const xviFcSubrole: 'reviewer' | 'viewer' = dto.subRole === 'EDITOR' ? 'reviewer' : 'viewer';

    // Always guard against an active user first — applies to all action paths
    const activeUser = await this.userModel.findOne({ email: dto.email, isDeleted: false }).select('_id').lean().exec();
    if (activeUser) {
      throw new HttpException(
        { code: 'EMAIL_ALREADY_ACTIVE', message: 'Email address is already registered' },
        HttpStatus.CONFLICT,
      );
    }

    if (action === 'invite') {
      // Email is scrambled at delete time, so deleted records never hold the original email.
      // Use originalEmail field to detect previously registered accounts.
      const deletedUser = await this.userModel
        .findOne({ originalEmail: dto.email, isDeleted: true })
        .select('name designation')
        .lean()
        .exec();

      if (deletedUser) {
        throw new HttpException(
          {
            code: 'EMAIL_PREVIOUSLY_REGISTERED',
            message: `This email was previously registered under ${deletedUser.name}.`,
            deletedUser: { name: deletedUser.name, designation: deletedUser.designation ?? '' },
          },
          HttpStatus.CONFLICT,
        );
      }

      return this.createFreshStateMember(dto, stateId, xviFcSubrole, requester);
    }

    if (action === 'restore') {
      const toRestore = await this.userModel
        .findOne({ originalEmail: dto.email, isDeleted: true })
        .lean()
        .exec();

      if (!toRestore) {
        // Race condition: already restored by another process — create fresh instead
        return this.createFreshStateMember(dto, stateId, xviFcSubrole, requester);
      }

      // No updateMany needed — email was already scrambled individually at delete time
      const restored = await this.userModel.findByIdAndUpdate(
        toRestore._id,
        {
          $set: {
            name: dto.name,
            email: dto.email,
            mobile: dto.mobile,
            designation: dto.designation,
            role: Role.STATE,
            xviFcSubrole,
            state: stateId,
            ulb: null,
            originalEmail: null,
            createdBy: new Types.ObjectId(String(requester._id)),
            isDeleted: false,
            isActive: true,
            status: 'PENDING',
            isXVIFCProfileVerified: false,
            isEmailVerified: false,
            isRegistered: false,
            password: 'UNSET',
            refreshTokenHash: null,
            loginAttempts: 0,
            isLocked: false,
          },
        },
        { new: true },
      ).lean().exec();

      if (!restored) throw new NotFoundException('User to restore could not be found');

      // Narrow race-condition guard: another active user with this email appeared during the restore window
      const raceConflict = await this.userModel.exists({
        email: dto.email,
        isDeleted: false,
        _id: { $ne: restored._id },
      });
      if (raceConflict) {
        await this.userModel.findByIdAndUpdate(restored._id, {
          $set: { isDeleted: true, email: `__deleted__${Date.now()}__${dto.email}`, originalEmail: dto.email },
        });
        throw new HttpException(
          { code: 'EMAIL_ALREADY_ACTIVE', message: 'Email address is already registered' },
          HttpStatus.CONFLICT,
        );
      }

      await this.queueInviteEmail(dto, stateId, requester);
      return this.toStateMemberDto(restored, dto);
    }

    if (action === 'force-new') {
      // Deleted records already have scrambled emails — email is free, create directly.
      // No tombstone or re-check needed.
      return this.createFreshStateMember(dto, stateId, xviFcSubrole, requester);
    }

    throw new BadRequestException('Invalid action');
  }

  private async createFreshStateMember(
    dto: InviteStateMemberDto,
    stateId: Types.ObjectId,
    xviFcSubrole: 'reviewer' | 'viewer',
    requester: AuthUser,
  ): Promise<StateMemberResponseDto> {
    const created = await this.userModel.create({
      name: dto.name,
      email: dto.email,
      mobile: dto.mobile,
      designation: dto.designation,
      role: Role.STATE,
      xviFcSubrole,
      state: stateId,
      createdBy: new Types.ObjectId(String(requester._id)),
      status: 'PENDING',
      isXVIFCProfileVerified: false,
      isEmailVerified: false,
      isActive: true,
      isDeleted: false,
      isLocked: false,
      loginAttempts: 0,
      password: 'UNSET',
      isRegistered: false,
      isVerified2223: false,
      isNodalOfficer: false,
    });

    await this.queueInviteEmail(dto, stateId, requester);
    return this.toStateMemberDto(created, dto);
  }

  private async queueInviteEmail(dto: InviteStateMemberDto, stateId: Types.ObjectId, requester: AuthUser): Promise<void> {
    const stateDoc = await this.stateModel.findById(stateId).select('name').lean().exec();
    const loginUrl = `${this.configService.get<string>('CLIENT_URL', 'https://cityfinance.in')}/xvifc`;
    this.emailQueueService
      .addEmailJob({
        to: dto.email,
        subject: 'You have been invited to the XVI Finance Commission Portal',
        templateName: './state-member-invite',
        mailData: {
          name: dto.name,
          mobile: dto.mobile,
          role: dto.subRole === 'EDITOR' ? 'Reviewer' : 'Viewer',
          stateName: stateDoc?.name ?? 'your state',
          invitedBy: 'State Administrator',
          loginUrl,
        },
      })
      .catch(() => {
        // Email failure must never roll back user creation
      });
  }

  private toStateMemberDto(user: { _id: unknown }, dto: InviteStateMemberDto): StateMemberResponseDto {
    return {
      _id: String(user._id),
      name: dto.name,
      mobile: dto.mobile,
      email: dto.email,
      designation: dto.designation,
      subRole: dto.subRole,
      isActive: true,
      isXVIFCProfileVerified: false,
      lastActive: null,
    };
  }

  /**
   * Sets per-user permission overrides for a managed user.
   *
   * allow  → grants permissions beyond the role default.
   * deny   → revokes permissions from the role default.
   *
   * The requester must be a ULB/STATE admin and the target user must
   * belong to the requester's own ULB or state.
   *
   * Returns the resulting effective permission set so the caller can
   * verify or display the new access level immediately.
   */
  async updatePermissionOverrides(
    targetUserId: string,
    dto: UpdatePermissionOverridesDto,
    requester: AuthUser,
  ): Promise<{
    message: string;
    overrides: { allow: Permission[]; deny: Permission[] };
    effectivePermissions: Permission[];
  }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role ulb state xviFcSubrole')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    const allow = dto.allow ?? [];
    const deny = dto.deny ?? [];

    // A permission can't be granted and revoked at the same time
    const conflict = allow.filter((p) => deny.includes(p));
    if (conflict.length > 0) {
      throw new BadRequestException(`These permissions appear in both allow and deny: ${conflict.join(', ')}`);
    }

    await this.userModel
      .findByIdAndUpdate(targetUserId, {
        $set: { 'permissionOverrides.allow': allow, 'permissionOverrides.deny': deny },
      })
      .exec();

    const effectivePermissions = getEffectivePermissions({
      role: targetUser.role as unknown as UserRole,
      xviFcSubrole: (targetUser as unknown as Record<string, unknown>)['xviFcSubrole'] as string | null,
      permissionOverrides: { allow, deny },
    });

    return {
      message: 'Permission overrides updated successfully',
      overrides: { allow, deny },
      effectivePermissions,
    };
  }

  async softDeleteUser(targetUserId: string, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role ulb state xviFcSubrole email')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    const originalEmail = targetUser.email ?? null;
    const tombstonedEmail = originalEmail
      ? `__deleted__${Date.now()}__${originalEmail}`
      : undefined;

    await this.userModel.findByIdAndUpdate(targetUserId, {
      $set: {
        isDeleted: true,
        ...(tombstonedEmail && { email: tombstonedEmail }),
        ...(originalEmail && { originalEmail }),
      },
    }).exec();

    return { message: 'User deleted successfully' };
  }

  async updateUserRole(
    targetUserId: string,
    dto: UpdateUserRoleDto,
    requester: AuthUser,
  ): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role ulb state xviFcSubrole')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { role: dto.role } }).exec();

    return { message: 'User role updated successfully' };
  }

  // ── Maps frontend display values to DB xviFcSubrole values ────────────────
  private static readonly DISPLAY_TO_XVIFC_SUBROLE: Record<string, 'reviewer' | 'viewer'> = {
    EDITOR: 'reviewer',
    VIEWER: 'viewer',
  };

  async updateXviFcSubrole(
    targetUserId: string,
    dto: UpdateXviFcSubroleDto,
    requester: AuthUser,
  ): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role ulb state xviFcSubrole')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    if ((targetUser.role as string) !== UserRole.STATE) {
      throw new BadRequestException('Sub-role updates are only supported for STATE users');
    }

    const newSubrole = UsersService.DISPLAY_TO_XVIFC_SUBROLE[dto.subRole];
    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { xviFcSubrole: newSubrole } }).exec();

    return { message: 'Sub-role updated successfully' };
  }

  async transferSubmitter(dto: TransferSubmitterDto, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(dto.toUserId)) throw new BadRequestException('Invalid toUserId');

    if (requester.role !== UserRole.STATE || requester.xviFcSubrole !== 'admin') {
      throw new ForbiddenException('Only the STATE admin (submitter) can transfer ownership');
    }

    const newOwner = await this.userModel
      .findOne({ _id: dto.toUserId, isDeleted: false })
      .select('role state xviFcSubrole isXVIFCProfileVerified')
      .lean()
      .exec();

    if (!newOwner) throw new NotFoundException('Target user not found');
    if ((newOwner.role as string) !== UserRole.STATE) {
      throw new BadRequestException('Target must be a STATE user');
    }
    if (newOwner.xviFcSubrole === 'admin') {
      throw new BadRequestException('Target is already the STATE admin');
    }
    if (!(newOwner as Record<string, unknown>)['isXVIFCProfileVerified']) {
      throw new BadRequestException('Ownership can only be transferred to an active member who has completed profile verification');
    }

    // Must belong to the same state
    const requesterStateId = requester.state?.toString();
    const targetStateId = newOwner.state?.toString();
    if (!requesterStateId || requesterStateId !== targetStateId) {
      throw new ForbiddenException('You can only transfer ownership within your own state');
    }

    // Promote new owner first, then demote current admin.
    // On failure of the second update, roll back the first to preserve consistency.
    await this.userModel
      .findByIdAndUpdate(dto.toUserId, { $set: { xviFcSubrole: 'admin' } })
      .exec();

    try {
      await this.userModel
        .findByIdAndUpdate(requester._id, { $set: { xviFcSubrole: 'reviewer' } })
        .exec();
    } catch (err) {
      // Rollback: restore the promoted user to their previous sub-role
      await this.userModel
        .findByIdAndUpdate(dto.toUserId, { $set: { xviFcSubrole: newOwner.xviFcSubrole } })
        .exec();
      throw err;
    }

    return { message: 'Ownership transferred successfully. You are now a Reviewer.' };
  }

  private static readonly UPDATABLE_FIELDS = new Set<string>([
    'name',
    'email',
    'mobile',
    'username',
    'designation',
    'organization',
    'address',
    'departmentName',
    'departmentContactNumber',
    'departmentEmail',
    'commissionerName',
    'commissionerEmail',
    'commissionerConatactNumber',
    'accountantName',
    'accountantEmail',
    'accountantConatactNumber',
    'status',
    'isNodalOfficer',
    'isXVIFCProfileVerified',
  ]);

  async updateProfileContacts(
    userId: string,
    dto: UpdateProfileContactsDto,
    requester: AuthUser,
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: userId, isDeleted: false })
      .select('ulb state')
      .lean()
      .exec();
    if (!targetUser) throw new NotFoundException('User not found');

    const isSelfUpdate = requester._id.toString() === userId;
    const isUlbScope = requester.scope === Scope.ULB;

    if (isSelfUpdate && !isUlbScope) {
      // State / MoHUA self-updates require a valid one-time save token (issued post-OTP)
      const { saveToken } = dto;
      if (!saveToken) throw new BadRequestException('A verified save token is required to update your profile');
      const stored = await this.redisService.get(this.saveTokenKey(userId));
      if (!stored || stored !== saveToken) {
        throw new HttpException('Save token is invalid or expired. Please verify your email again.', 422);
      }
      await this.redisService.del(this.saveTokenKey(userId));
    }

    // Strip saveToken — it is not a DB field
    const { saveToken: _t, ...rest } = dto;
    const unknown = Object.keys(rest).filter((k) => !UsersService.UPDATABLE_FIELDS.has(k));
    if (unknown.length) throw new BadRequestException(`Field(s) not updatable: ${unknown.join(', ')}`);

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }
    if (!Object.keys(update).length) throw new BadRequestException('No fields provided to update');

    await this.userModel.findByIdAndUpdate(userId, { $set: update }).exec();

    // ── NEW: after a state user's OTP-verified profile save, assign xviFcSubrole across the whole state
    if (isSelfUpdate && !isUlbScope && update['isXVIFCProfileVerified'] === true && targetUser.state) {
      await this.assignXviFcSubrolesByState(targetUser.state);
    }
    // ── END NEW

    return { message: 'Profile contacts updated successfully', updatedFields: update };
  }

  // ── NEW: XVI-FC sub-role assignment block (state workflow only) ───────────────

  // Roles considered "state scope" for the XVI-FC module
  private static readonly XVIFC_STATE_ROLES: string[] = [
    Role.STATE, // primary state admin
    // Role.XVIFC_STATE,  // state user in XVI-FC portal
    // Role.STATE_EDITOR, // state editor
    // Role.STATE_VIEWER, // state viewer
  ];

  // Triggered once per state after OTP verification:
  //   isNodalOfficer: true  → xviFcSubrole: 'admin'
  //   isNodalOfficer: false → xviFcSubrole: 'reviewer'
  // Runs two parallel updateMany calls — no full collection scan.
  private async assignXviFcSubrolesByState(stateId: Types.ObjectId): Promise<void> {
    const scope = {
      state: stateId,
      isDeleted: false,
      role: { $in: UsersService.XVIFC_STATE_ROLES },
      // $ne: true catches false, null, and undefined (legacy docs that predate the field)
      isXVIFCProfileVerified: { $ne: true },
    };

    await Promise.all([
      this.userModel.updateMany({ ...scope, isNodalOfficer: true }, { $set: { xviFcSubrole: 'admin' } }).exec(),
      this.userModel
        .updateMany({ ...scope, isNodalOfficer: { $ne: true } }, { $set: { xviFcSubrole: 'reviewer' } })
        .exec(),
    ]);
  }
  // ── END NEW

  // ─── xviFcSubrole → frontend subRole mapping ──────────────────────────────
  // xviFcSubrole is the single source of truth for state-scope sub-classification.
  // DB role is just 'STATE' for everyone; admin/reviewer/viewer live in this field.
  private static readonly XVIFC_TO_SUB_ROLE: Record<string, 'SUBMITTER' | 'EDITOR' | 'VIEWER'> = {
    admin: 'SUBMITTER',
    reviewer: 'EDITOR',
    viewer: 'VIEWER',
  };

  async getStateMembers(stateId: string): Promise<StateMemberResponseDto[]> {
    if (!Types.ObjectId.isValid(stateId)) throw new BadRequestException('Invalid state ID');

    const users = await this.userModel
      .find({
        state: new Types.ObjectId(stateId),
        role: UserRole.STATE,
        isDeleted: false,
      })
      .select('_id name mobile email designation xviFcSubrole isActive isXVIFCProfileVerified lastLoginAt')
      .lean()
      .exec();

    return users.map((u) => ({
      _id: String(u._id),
      name: u.name,
      mobile: u.mobile ?? '',
      ...(u.email ? { email: u.email } : {}),
      designation: u.designation ?? '',
      subRole: UsersService.XVIFC_TO_SUB_ROLE[u.xviFcSubrole as string] ?? 'VIEWER',
      isActive: u.isActive ?? false,
      isXVIFCProfileVerified: (u as Record<string, unknown>).isXVIFCProfileVerified === true,
      lastActive: u.lastLoginAt ? (u.lastLoginAt as Date).toISOString() : null,
    }));
  }

  async getMohuaMembers(): Promise<StateMemberResponseDto[]> {
    const users = await this.userModel
      .find({ role: Role.MoHUA, isDeleted: false })
      .select('_id name mobile email designation isActive lastLoginAt')
      .lean()
      .exec();

    return users.map((u) => ({
      _id: String(u._id),
      name: u.name,
      mobile: u.mobile ?? '',
      ...(u.email ? { email: u.email } : {}),
      designation: u.designation ?? '',
      subRole: 'VIEWER' as const,
      isActive: u.isActive ?? false,
      isXVIFCProfileVerified: true,
      lastActive: u.lastLoginAt ? (u.lastLoginAt as Date).toISOString() : null,
    }));
  }

  /**
   * Returns the permission matrix rows for the requester's scope.
   * Used only for UI display — not a security decision.
   */
  getPermissionMatrix(): PermissionMatrixRow[] {
    return STATE_MATRIX;
  }

  async getProfileContacts(id: string): Promise<ProfileContactsResponseDto> {
    const user = await this.userModel
      .findById(id)
      .select(
        'commissionerName commissionerEmail commissionerConatactNumber accountantName accountantEmail accountantConatactNumber ulb',
      )
      .populate({
        path: 'ulb',
        select: 'name code censusCode population area wards ulbType state',
        populate: { path: 'state', select: 'name' },
      })
      .lean()
      .exec();

    if (!user) throw new NotFoundException('User not found');

    // ulbType has no NestJS schema — query its collection directly via the connection
    let ulbTypeName = '';
    const ulb = user.ulb as unknown as Record<string, unknown> | null;
    if (ulb && typeof ulb === 'object') {
      if (ulb['ulbType']) {
        try {
          const ulbTypeDoc = await this.userModel.db
            .collection('ulbtypes')
            .findOne({ _id: ulb['ulbType'] }, { projection: { name: 1 } });
          ulbTypeName = ((ulbTypeDoc as Record<string, unknown> | null)?.['name'] as string) ?? '';
        } catch {
          /* collection unavailable — leave blank */
        }
      }
    }

    const stateName = ((ulb?.['state'] as Record<string, unknown> | null)?.['name'] as string) ?? '';

    const ulbDetails = ulb
      ? { name: (ulb['name'] as string) ?? '', code: (ulb['code'] as string) ?? '', stateName }
      : null;

    const registeredMunicipalInfo = ulb
      ? {
          stateName,
          ulbType: ulbTypeName,
          censusCode: (ulb['censusCode'] as string) ?? '',
          ulbCode: (ulb['code'] as string) ?? '',
          area: (ulb['area'] as number) ?? 0,
          population: (ulb['population'] as number) ?? 0,
          wards: (ulb['wards'] as number) ?? 0,
        }
      : null;

    return {
      commissionerName: user.commissionerName ?? '',
      commissionerEmail: user.commissionerEmail ?? '',
      commissionerConatactNumber: user.commissionerConatactNumber ?? '',
      accountantName: user.accountantName ?? '',
      accountantEmail: user.accountantEmail ?? '',
      accountantConatactNumber: user.accountantConatactNumber ?? '',
      ulbDetails,
      registeredMunicipalInfo,
    };
  }


}

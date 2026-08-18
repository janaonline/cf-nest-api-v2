import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { PORTAL_INVITE_LOGIN_TYPE, buildPortalAuthUrls } from 'src/core/utils/portal-urls.util';
import { User } from 'src/schemas/user/user.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ProfileContactsResponseDto } from './dto/profile-contacts-response.dto';
import { InviteStateMemberDto } from './dto/invite-state-member.dto';
import { InviteMohuaMemberDto } from './dto/invite-mohua-member.dto';
import { UpdatePermissionOverridesDto } from './dto/update-permission-overrides.dto';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { StateMemberResponseDto } from './dto/state-member-response.dto';
import { UpdateXviFcSubroleDto } from './dto/update-xvi-fc-subrole.dto';
import { TransferSubmitterDto } from './dto/transfer-submitter.dto';
import { EmailDomainValidationService } from 'src/core/email-domain-validation/email-domain-validation.service';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';

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
    reviewer: true,
    viewer: false,
  },
  { label: 'Manage users', permissionKey: Permission.MANAGE_USERS, admin: true, reviewer: false, viewer: false },
];

const MOHUA_MATRIX: PermissionMatrixRow[] = [
  {
    label: 'View status and reports',
    permissionKey: Permission.VIEW_STATUS_REPORTS,
    admin: true,
    reviewer: true,
    viewer: true,
  },
  { label: 'View dashboards', permissionKey: Permission.VIEW_DASHBOARDS, admin: true, reviewer: true, viewer: true },
  {
    label: 'Review state submissions',
    permissionKey: Permission.REVIEW_ULB_SUBMISSIONS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Send reminders to states',
    permissionKey: Permission.MESSAGE_USERS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Request information from states',
    permissionKey: Permission.MESSAGE_USERS,
    admin: true,
    reviewer: true,
    viewer: false,
  },
  {
    label: 'Approve / Reject submissions',
    permissionKey: Permission.APPROVE_ULB_SUBMISSIONS,
    admin: true,
    reviewer: false,
    viewer: false,
  },
  {
    label: 'Issue Office Memorandum (OM)',
    permissionKey: Permission.PREPARE_GRANT_LETTERS,
    admin: true,
    reviewer: false,
    viewer: false,
  },
  {
    label: 'Final submit to DoE',
    permissionKey: Permission.FINAL_SUBMIT_TO_MOHUA,
    admin: true,
    reviewer: false,
    viewer: false,
  },
  { label: 'Manage team', permissionKey: Permission.MANAGE_USERS, admin: true, reviewer: false, viewer: false },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private static readonly SAVE_TOKEN_TTL = 120; // 2 minutes — consumed on first use
  private saveTokenKey = (userId: string) => `profile_save_token:${userId}`;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(State.name) private stateModel: Model<StateDocument>,
    private readonly redisService: RedisService,
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService,
    private readonly emailDomainValidation: EmailDomainValidationService,
  ) {}

  private throwValidationError(errors: XviFcValidationErrorMap): never {
    throw new BadRequestException({ message: 'Validation failed', errors });
  }

  /** Guards against saving a Commissioner/Nodal Officer email whose domain can't actually
   *  receive mail (typo'd or made-up domain) — @IsEmail() only checks syntax, not that the
   *  domain is real. Same check and same fail-open-on-DNS-trouble policy as
   *  UlbService.ensureEmailDomainIsReachable, reused here for the profile-verification flow. */
  private async assertProfileContactEmailsAreDeliverable(dto: UpdateProfileContactsDto): Promise<void> {
    const checks: Array<{ field: 'commissionerEmail' | 'accountantEmail'; email: string }> = [];
    if (dto.commissionerEmail) checks.push({ field: 'commissionerEmail', email: dto.commissionerEmail });
    if (dto.accountantEmail) checks.push({ field: 'accountantEmail', email: dto.accountantEmail });
    if (!checks.length) return;

    const results = await Promise.all(
      checks.map(async (c) => ({ ...c, hasMx: await this.emailDomainValidation.domainHasMxRecord(c.email) })),
    );
    const errors: XviFcValidationErrorMap = {};
    for (const r of results) {
      if (!r.hasMx) {
        errors[r.field] = [
          {
            field: r.field,
            message: "This email domain doesn't appear to accept mail. Check for a typo in the email address.",
            code: 'domainMx',
          },
        ];
      }
    }
    if (Object.keys(errors).length) this.throwValidationError(errors);
  }

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

  async inviteStateMember(dto: InviteStateMemberDto, requester: AuthUser): Promise<StateMemberResponseDto> {
    if (!requester.state) throw new ForbiddenException('No state scope on this account');

    const action = dto.action ?? 'invite';
    const stateId = new Types.ObjectId(String(requester.state));
    const xviFcSubrole: 'reviewer' | 'viewer' = dto.subRole === 'EDITOR' ? 'reviewer' : 'viewer';

    // Guard: email belongs to a fully active XVI-FC member (not XVI-FC removed)
    const activeUser = await this.userModel
      .findOne({ email: dto.email, isDeleted: false, isXviFcdeleted: { $ne: true } })
      .select('_id')
      .lean()
      .exec();
    if (activeUser) {
      throw new HttpException(
        { code: 'EMAIL_ALREADY_ACTIVE', message: 'Email address is already registered' },
        HttpStatus.CONFLICT,
      );
    }

    if (action === 'invite') {
      // Check if this email belongs to a member that was XVI-FC removed (isXviFcdeleted: true).
      // Email is never scrambled in the new flow, so we match directly on the email field.
      const removedUser = await this.userModel
        .findOne({ email: dto.email, isDeleted: false, isXviFcdeleted: true })
        .select('name designation')
        .lean()
        .exec();

      if (removedUser) {
        throw new HttpException(
          {
            code: 'EMAIL_XVIFC_REMOVED',
            message: `This email belongs to ${removedUser.name} who was previously removed from the team.`,
            removedUser: { name: removedUser.name, designation: removedUser.designation ?? '' },
          },
          HttpStatus.CONFLICT,
        );
      }

      return this.createFreshStateMember(dto, stateId, xviFcSubrole, requester);
    }

    if (action === 'restore') {
      const toRestore = await this.userModel
        .findOne({ email: dto.email, isDeleted: false, isXviFcdeleted: true })
        .lean()
        .exec();

      if (!toRestore) {
        // Already restored by another request — create fresh
        return this.createFreshStateMember(dto, stateId, xviFcSubrole, requester);
      }

      const placeholderPassword = this.generatePlaceholderPassword();
      const hashedPassword = await bcrypt.hash(placeholderPassword, 12);

      const restored = await this.userModel
        .findByIdAndUpdate(
          toRestore._id,
          {
            $set: {
              name: dto.name,
              mobile: dto.mobile,
              designation: dto.designation,
              xviFcSubrole,
              state: stateId,
              isXviFcdeleted: false,
              createdBy: new Types.ObjectId(String(requester._id)),
              isActive: true,
              isXVIFCProfileVerified: false,
              password: hashedPassword,
              isNewUser: true,
              refreshTokenHash: null,
              loginAttempts: 0,
              isLocked: false,
            },
          },
          { new: true },
        )
        .lean()
        .exec();

      if (!restored) throw new NotFoundException('User to restore could not be found');

      // Race-condition guard: another active member with this email appeared during the restore window
      const raceConflict = await this.userModel.exists({
        email: dto.email,
        isDeleted: false,
        isXviFcdeleted: { $ne: true },
        _id: { $ne: restored._id },
      });
      if (raceConflict) {
        await this.userModel.findByIdAndUpdate(restored._id, { $set: { isXviFcdeleted: true } });
        throw new HttpException(
          { code: 'EMAIL_ALREADY_ACTIVE', message: 'Email address is already registered' },
          HttpStatus.CONFLICT,
        );
      }

      await this.queueInviteEmail(dto, stateId, requester);
      return this.toStateMemberDto(restored, dto);
    }

    throw new BadRequestException('Invalid action');
  }

  /** Generates a random password that is never revealed to anyone — the account is created with
   *  it purely to satisfy the schema's required `password` field. It's unlocked exclusively via
   *  the Forgot Password OTP flow (`OtpService.sendOtp`/`forgotPasswordReset`), not by this value. */
  private generatePlaceholderPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '@#$%^&*!';
    const all = upper + lower + digits + symbols;
    const pick = (set: string) => set[randomBytes(1)[0] % set.length];
    const chars = [
      pick(upper),
      pick(upper),
      pick(lower),
      pick(lower),
      pick(digits),
      pick(digits),
      pick(symbols),
      ...Array.from({ length: 5 }, () => pick(all)),
    ];
    // Crypto Fisher-Yates shuffle
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  private async createFreshStateMember(
    dto: InviteStateMemberDto,
    stateId: Types.ObjectId,
    xviFcSubrole: 'reviewer' | 'viewer',
    requester: AuthUser,
  ): Promise<StateMemberResponseDto> {
    const placeholderPassword = this.generatePlaceholderPassword();
    const hashedPassword = await bcrypt.hash(placeholderPassword, 12);

    const created = await this.userModel.create({
      name: dto.name,
      email: dto.email,
      mobile: dto.mobile,
      designation: dto.designation,
      role: Role.STATE,
      xviFcSubrole,
      state: stateId,
      createdBy: new Types.ObjectId(String(requester._id)),
      status: 'APPROVED',
      isXVIFCProfileVerified: false,
      isEmailVerified: true,
      isActive: true,
      isDeleted: false,
      isLocked: false,
      loginAttempts: 0,
      password: hashedPassword,
      isNewUser: true,
      isRegistered: false,
      isVerified2223: false,
      isNodalOfficer: false,
    });

    await this.queueInviteEmail(dto, stateId, requester);
    return this.toStateMemberDto(created, dto);
  }

  private async queueInviteEmail(
    dto: InviteStateMemberDto,
    stateId: Types.ObjectId,
    requester: AuthUser,
  ): Promise<void> {
    const stateDoc = await this.stateModel.findById(stateId).select('name').lean().exec();
    const { loginUrl, resetPasswordUrl } = buildPortalAuthUrls(this.configService);
    this.emailQueueService
      .addEmailJob({
        to: dto.email,
        subject: 'You have been invited to the XVI Finance Commission Portal',
        templateName: './state-member-invite',
        mailData: {
          name: dto.name,
          email: dto.email,
          mobile: dto.mobile,
          role: dto.subRole === 'EDITOR' ? 'Reviewer' : 'Viewer',
          stateName: stateDoc?.name ?? 'your state',
          invitedBy: 'State Administrator',
          loginUrl,
          resetPasswordUrl,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Failed to queue state member invite email to ${dto.email}:`, err);
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

  async softDeleteStateUser(targetUserId: string, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role ulb state xviFcSubrole email')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    // STATE users are removed from the XVI-FC portal only — isDeleted is left unchanged
    // so 15th FC data is not affected. Email is preserved so the user can be restored later.
    if ((targetUser.role as string) === UserRole.STATE) {
      if ((targetUser as Record<string, unknown>)['xviFcSubrole'] === 'admin') {
        throw new BadRequestException('Cannot remove the Admin. Transfer ownership first.');
      }
      if (targetUserId === String(requester._id)) {
        throw new BadRequestException('You cannot remove yourself from the team');
      }
      await this.userModel.findByIdAndUpdate(targetUserId, { $set: { isXviFcdeleted: true } }).exec();
      return { message: 'Member removed from the XVI-FC portal' };
    }

    // Non-STATE users (ULB managed users etc.) — full hard soft-delete with tombstoning
    const originalEmail = targetUser.email ?? null;
    const tombstonedEmail = originalEmail ? `__deleted__${Date.now()}__${originalEmail}` : undefined;

    await this.userModel
      .findByIdAndUpdate(targetUserId, {
        $set: {
          isDeleted: true,
          ...(tombstonedEmail && { email: tombstonedEmail }),
          ...(originalEmail && { originalEmail }),
        },
      })
      .exec();

    return { message: 'User deleted successfully' };
  }

  // async updateUserRole(
  //   targetUserId: string,
  //   dto: UpdateUserRoleDto,
  //   requester: AuthUser,
  // ): Promise<{ message: string }> {
  //   if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

  //   const targetUser = await this.userModel
  //     .findOne({ _id: targetUserId, isDeleted: false })
  //     .select('role ulb state xviFcSubrole')
  //     .lean()
  //     .exec();

  //   if (!targetUser) throw new NotFoundException('User not found');

  //   await this.userModel.findByIdAndUpdate(targetUserId, { $set: { role: dto.role } }).exec();

  //   return { message: 'User role updated successfully' };
  // }

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
      throw new BadRequestException(
        'Ownership can only be transferred to an active member who has completed profile verification',
      );
    }

    // Must belong to the same state
    const requesterStateId = requester.state?.toString();
    const targetStateId = newOwner.state?.toString();
    if (!requesterStateId || requesterStateId !== targetStateId) {
      throw new ForbiddenException('You can only transfer ownership within your own state');
    }

    // Promote new owner first, then demote current admin.
    // On failure of the second update, roll back the first to preserve consistency.
    await this.userModel.findByIdAndUpdate(dto.toUserId, { $set: { xviFcSubrole: 'admin' } }).exec();

    try {
      await this.userModel.findByIdAndUpdate(requester._id, { $set: { xviFcSubrole: 'reviewer' } }).exec();
    } catch (err) {
      // Rollback: restore the promoted user to their previous sub-role
      await this.userModel.findByIdAndUpdate(dto.toUserId, { $set: { xviFcSubrole: newOwner.xviFcSubrole } }).exec();
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
    'isXviFcdeleted',
  ]);

  async updateProfileContacts(
    userId: string,
    dto: UpdateProfileContactsDto,
    requester: AuthUser,
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: userId, isDeleted: false })
      .select('ulb state isNodalOfficer xviFcSubrole')
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

    await this.assertProfileContactEmailsAreDeliverable(dto);

    // Strip saveToken — it is not a DB field
    const { saveToken: _t, ...rest } = dto;
    const unknown = Object.keys(rest).filter((k) => !UsersService.UPDATABLE_FIELDS.has(k));
    if (unknown.length) throw new BadRequestException(`Field(s) not updatable: ${unknown.join(', ')}`);

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }
    if (!Object.keys(update).length) throw new BadRequestException('No fields provided to update');

    // When a STATE user verifies their profile, derive and stamp their own xviFcSubrole
    // in the same write — assignXviFcSubrolesByState skips already-verified users so
    // without this the verifying user's subrole would never be set.
    const isStateProfileVerify =
      isSelfUpdate && !isUlbScope && update['isXVIFCProfileVerified'] === true && targetUser.state;

    // Only derive subrole if one has not been manually assigned already
    if (isStateProfileVerify && !(targetUser as Record<string, unknown>)['xviFcSubrole']) {
      update['xviFcSubrole'] = targetUser.isNodalOfficer ? 'admin' : 'reviewer';
    }

    await this.userModel.findByIdAndUpdate(userId, { $set: update }).exec();

    if (isStateProfileVerify) {
      await this.assignXviFcSubrolesByState(targetUser.state!);
    }

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
      // Only initialise subrole for users who don't have one yet — never overwrite manual assignments
      xviFcSubrole: { $in: [null, ''] },
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
        isXviFcdeleted: { $ne: true },
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
      .find({ role: Role.MoHUA, isXviFcdeleted: { $ne: true }, isDeleted: false })
      .select('_id name mobile email designation xviFcSubrole isActive isXVIFCProfileVerified lastLoginAt')
      .lean()
      .exec();
    console.log('users', users);
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

  async inviteMohuaMember(dto: InviteMohuaMemberDto, requester: AuthUser): Promise<StateMemberResponseDto> {
    const action = dto.action ?? 'invite';
    const xviFcSubrole: 'reviewer' | 'viewer' = dto.subRole === 'EDITOR' ? 'reviewer' : 'viewer';

    // Guard: email belongs to a fully active XVI-FC member (not XVI-FC removed)
    const activeUser = await this.userModel
      .findOne({ email: dto.email, isDeleted: false, isXviFcdeleted: { $ne: true } })
      .select('_id')
      .lean()
      .exec();
    if (activeUser) {
      throw new HttpException(
        { code: 'EMAIL_ALREADY_ACTIVE', message: 'Email address is already registered' },
        HttpStatus.CONFLICT,
      );
    }

    if (action === 'invite') {
      const removedUser = await this.userModel
        .findOne({ email: dto.email, isDeleted: false, isXviFcdeleted: true })
        .select('name designation')
        .lean()
        .exec();

      if (removedUser) {
        throw new HttpException(
          {
            code: 'EMAIL_XVIFC_REMOVED',
            message: `This email belongs to ${removedUser.name} who was previously removed from the team.`,
            removedUser: { name: removedUser.name, designation: removedUser.designation ?? '' },
          },
          HttpStatus.CONFLICT,
        );
      }

      return this.createFreshMohuaMember(dto, xviFcSubrole, requester);
    }

    if (action === 'restore') {
      const toRestore = await this.userModel
        .findOne({ email: dto.email, isDeleted: false, isXviFcdeleted: true })
        .lean()
        .exec();

      if (!toRestore) {
        // Already restored by another request — create fresh
        return this.createFreshMohuaMember(dto, xviFcSubrole, requester);
      }

      const placeholderPassword = this.generatePlaceholderPassword();
      const hashedPassword = await bcrypt.hash(placeholderPassword, 12);

      const restored = await this.userModel
        .findByIdAndUpdate(
          toRestore._id,
          {
            $set: {
              name: dto.name,
              mobile: dto.mobile,
              designation: dto.designation,
              xviFcSubrole,
              isXviFcdeleted: false,
              createdBy: new Types.ObjectId(String(requester._id)),
              isActive: true,
              isXVIFCProfileVerified: false,
              password: hashedPassword,
              isNewUser: true,
              refreshTokenHash: null,
              loginAttempts: 0,
              isLocked: false,
            },
          },
          { new: true },
        )
        .lean()
        .exec();

      if (!restored) throw new NotFoundException('User to restore could not be found');

      // Race-condition guard: another active member with this email appeared during the restore window
      const raceConflict = await this.userModel.exists({
        email: dto.email,
        isDeleted: false,
        isXviFcdeleted: { $ne: true },
        _id: { $ne: restored._id },
      });
      if (raceConflict) {
        await this.userModel.findByIdAndUpdate(restored._id, { $set: { isXviFcdeleted: true } });
        throw new HttpException(
          { code: 'EMAIL_ALREADY_ACTIVE', message: 'Email address is already registered' },
          HttpStatus.CONFLICT,
        );
      }

      await this.queueMohuaInviteEmail(dto, requester);
      return this.toMohuaMemberDto(restored, dto);
    }

    throw new BadRequestException('Invalid action');
  }

  private async createFreshMohuaMember(
    dto: InviteMohuaMemberDto,
    xviFcSubrole: 'reviewer' | 'viewer',
    requester: AuthUser,
  ): Promise<StateMemberResponseDto> {
    const placeholderPassword = this.generatePlaceholderPassword();
    const hashedPassword = await bcrypt.hash(placeholderPassword, 12);

    const created = await this.userModel.create({
      name: dto.name,
      email: dto.email,
      mobile: dto.mobile,
      designation: dto.designation,
      role: Role.MoHUA,
      xviFcSubrole,
      createdBy: new Types.ObjectId(String(requester._id)),
      status: 'APPROVED',
      isXVIFCProfileVerified: false,
      isEmailVerified: true,
      isActive: true,
      isDeleted: false,
      isLocked: false,
      loginAttempts: 0,
      password: hashedPassword,
      isNewUser: true,
    });

    await this.queueMohuaInviteEmail(dto, requester);
    return this.toMohuaMemberDto(created, dto);
  }

  private async queueMohuaInviteEmail(dto: InviteMohuaMemberDto, requester: AuthUser): Promise<void> {
    const { loginUrl, resetPasswordUrl } = buildPortalAuthUrls(this.configService, PORTAL_INVITE_LOGIN_TYPE);
    this.emailQueueService
      .addEmailJob({
        to: dto.email,
        subject: 'You have been invited to the XVI Finance Commission Portal (MoHUA)',
        templateName: './mohua-member-invite',
        mailData: {
          name: dto.name,
          email: dto.email,
          mobile: dto.mobile,
          role: dto.subRole === 'EDITOR' ? 'Reviewer' : 'Viewer',
          invitedBy: String(requester['name'] ?? 'MoHUA Submitter'),
          loginUrl,
          resetPasswordUrl,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Failed to queue MoHUA member invite email to ${dto.email}:`, err);
      });
  }

  private toMohuaMemberDto(user: { _id: unknown }, dto: InviteMohuaMemberDto): StateMemberResponseDto {
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

  async updateMohuaMemberSubrole(
    targetUserId: string,
    dto: UpdateXviFcSubroleDto,
    requester: AuthUser,
  ): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    if ((requester.role as string) !== Role.MoHUA || requester.xviFcSubrole !== 'admin') {
      throw new ForbiddenException('Only the MoHUA Submitter can change member roles');
    }

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role xviFcSubrole')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');
    if ((targetUser.role as string) !== Role.MoHUA) {
      throw new BadRequestException('Sub-role updates are only supported for MoHUA users');
    }
    if (targetUser.xviFcSubrole === 'admin') {
      throw new BadRequestException(
        "Cannot change the Submitter's role via this endpoint. Use transfer ownership instead.",
      );
    }

    const newSubrole = UsersService.DISPLAY_TO_XVIFC_SUBROLE[dto.subRole];
    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { xviFcSubrole: newSubrole } }).exec();

    return { message: 'Sub-role updated successfully' };
  }

  async transferMohuaSubmitter(dto: TransferSubmitterDto, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(dto.toUserId)) throw new BadRequestException('Invalid toUserId');

    if ((requester.role as string) !== Role.MoHUA || requester.xviFcSubrole !== 'admin') {
      throw new ForbiddenException('Only the MoHUA Submitter can transfer ownership');
    }

    const newOwner = await this.userModel
      .findOne({ _id: dto.toUserId, isDeleted: false })
      .select('role xviFcSubrole isXVIFCProfileVerified')
      .lean()
      .exec();

    if (!newOwner) throw new NotFoundException('Target user not found');
    if ((newOwner.role as string) !== Role.MoHUA) {
      throw new BadRequestException('Target must be a MoHUA user');
    }
    if (newOwner.xviFcSubrole === 'admin') {
      throw new BadRequestException('Target is already the MoHUA Submitter');
    }
    if (!(newOwner as Record<string, unknown>)['isXVIFCProfileVerified']) {
      throw new BadRequestException(
        'Ownership can only be transferred to an active member who has completed profile verification',
      );
    }

    await this.userModel.findByIdAndUpdate(dto.toUserId, { $set: { xviFcSubrole: 'admin' } }).exec();

    try {
      await this.userModel.findByIdAndUpdate(requester._id, { $set: { xviFcSubrole: 'reviewer' } }).exec();
    } catch (err) {
      await this.userModel.findByIdAndUpdate(dto.toUserId, { $set: { xviFcSubrole: newOwner.xviFcSubrole } }).exec();
      throw err;
    }

    return { message: 'Ownership transferred successfully. You are now an Editor.' };
  }

  async softDeleteMohuaMember(targetUserId: string, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    if ((requester.role as string) !== Role.MoHUA || requester.xviFcSubrole !== 'admin') {
      throw new ForbiddenException('Only the MoHUA Submitter can remove members');
    }

    if (targetUserId === String(requester._id)) {
      throw new BadRequestException('You cannot remove yourself from the team');
    }

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role xviFcSubrole email')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');
    if ((targetUser.role as string) !== Role.MoHUA) {
      throw new BadRequestException('Can only remove MoHUA team members');
    }
    if (targetUser.xviFcSubrole === 'admin') {
      throw new BadRequestException('Cannot remove the Submitter. Transfer ownership first.');
    }

    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { isXviFcdeleted: true } }).exec();

    return { message: 'Member removed successfully' };
  }

  /** Patch role + xviFcSubrole on the two existing core MoHUA accounts. ADMIN scope only. */
  async patchMohuaCoreSubroles(requester: AuthUser): Promise<{ updated: string[]; notFound: string[] }> {
    if (requester.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only platform admins can patch core MoHUA sub-roles');
    }

    const targets: Array<{ email: string; xviFcSubrole: 'admin' | 'reviewer' }> = [
      { email: 'mohua@cityfinance.in', xviFcSubrole: 'admin' },
      { email: 'gsdhillon.ofb@ofb.gov.in', xviFcSubrole: 'reviewer' },
    ];

    const updated: string[] = [];
    const notFound: string[] = [];

    for (const target of targets) {
      const result = await this.userModel
        .findOneAndUpdate(
          { email: target.email, isDeleted: false },
          { $set: { role: Role.MoHUA, xviFcSubrole: target.xviFcSubrole } },
        )
        .lean()
        .exec();

      if (result) {
        updated.push(target.email);
      } else {
        notFound.push(target.email);
      }
    }

    return { updated, notFound };
  }

  getMohuaPermissionMatrix(): PermissionMatrixRow[] {
    return MOHUA_MATRIX;
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
        select: 'name code censusCode sbCode population area wards ulbType state',
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
          censusCode: ((ulb['censusCode'] as string) || (ulb['sbCode'] as string)) ?? '',
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

import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { User } from 'src/schemas/user/user.schema';
import { Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ProfileContactsResponseDto } from './dto/profile-contacts-response.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdatePermissionOverridesDto } from './dto/update-permission-overrides.dto';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { assertAdminSameScope, assertManageableTarget, resolveAdminScopeTarget } from './user-scope.helpers';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';

// ─── Permission-matrix display types ────────────────────────────────────────

export interface PermissionMatrixRow {
  label: string;
  permissionKey: Permission;
  submitter: boolean;
  editor: boolean;
  viewer: boolean;
}

// Static matrix definitions (for UI display only — not security)
const ULB_MATRIX: PermissionMatrixRow[] = [
  {
    label: 'View status and reports',
    permissionKey: Permission.VIEW_STATUS_REPORTS,
    submitter: true,
    editor: true,
    viewer: true,
  },
  {
    label: 'Upload documents',
    permissionKey: Permission.UPLOAD_DOCUMENTS,
    submitter: true,
    editor: true,
    viewer: false,
  },
  { label: 'Message users', permissionKey: Permission.MESSAGE_USERS, submitter: true, editor: true, viewer: false },
  {
    label: 'Final submit to State DMA',
    permissionKey: Permission.FINAL_SUBMIT_TO_STATE_DMA,
    submitter: true,
    editor: false,
    viewer: false,
  },
  { label: 'Manage users', permissionKey: Permission.MANAGE_USERS, submitter: true, editor: false, viewer: false },
];
const STATE_MATRIX: PermissionMatrixRow[] = [
  {
    label: 'View status and reports',
    permissionKey: Permission.VIEW_STATUS_REPORTS,
    submitter: true,
    editor: true,
    viewer: true,
  },
  { label: 'View dashboards', permissionKey: Permission.VIEW_DASHBOARDS, submitter: true, editor: true, viewer: true },
  {
    label: 'Upload state-level documents',
    permissionKey: Permission.UPLOAD_STATE_LEVEL_DOCUMENTS,
    submitter: true,
    editor: true,
    viewer: false,
  },
  {
    label: 'Review ULB submissions',
    permissionKey: Permission.REVIEW_ULB_SUBMISSIONS,
    submitter: true,
    editor: true,
    viewer: false,
  },
  { label: 'Message users', permissionKey: Permission.MESSAGE_USERS, submitter: true, editor: true, viewer: false },
  {
    label: 'Approve ULB submissions',
    permissionKey: Permission.APPROVE_ULB_SUBMISSIONS,
    submitter: true,
    editor: false,
    viewer: false,
  },
  {
    label: 'Prepare grant letters',
    permissionKey: Permission.PREPARE_GRANT_LETTERS,
    submitter: true,
    editor: false,
    viewer: false,
  },
  {
    label: 'Recommend exemptions',
    permissionKey: Permission.RECOMMEND_EXEMPTIONS,
    submitter: true,
    editor: false,
    viewer: false,
  },
  {
    label: 'Final submit to MoHUA',
    permissionKey: Permission.FINAL_SUBMIT_TO_MOHUA,
    submitter: true,
    editor: false,
    viewer: false,
  },
  { label: 'Manage users', permissionKey: Permission.MANAGE_USERS, submitter: true, editor: false, viewer: false },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  private static readonly SAVE_TOKEN_TTL = 120; // 2 minutes — consumed on first use
  private saveTokenKey = (userId: string) => `profile_save_token:${userId}`;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly redisService: RedisService,
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
    const { creatorId, targetStateId, targetUlbId } = resolveAdminScopeTarget(creator, dto.role, {
      ulbId: dto.ulbId,
      stateId: dto.stateId,
    });

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
      createdBy: new Types.ObjectId(creatorId),
      ...(targetStateId && { state: new Types.ObjectId(targetStateId) }),
      ...(targetUlbId && { ulb: new Types.ObjectId(targetUlbId) }),
    };

    const user = await this.userModel.create(createPayload);
    const obj = user.toObject() as unknown as Record<string, unknown>;
    delete obj.password;
    delete obj.refreshTokenHash;
    return obj;
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
      .select('role ulb state')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    assertAdminSameScope(requester, targetUser);

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
      .select('role ulb state')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    assertManageableTarget(requester, targetUser);

    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { isDeleted: true } }).exec();

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
      .select('role ulb state')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    assertManageableTarget(requester, targetUser);

    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { role: dto.role } }).exec();

    return { message: 'User role updated successfully' };
  }

  async transferOwnership(dto: TransferOwnershipDto, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(dto.newOwnerId)) throw new BadRequestException('Invalid newOwnerId');

    // requester must be a ULB or STATE admin (or platform ADMIN)
    const ownerRoles = [UserRole.ULB, UserRole.STATE] as string[];
    if (requester.role !== UserRole.ADMIN && !ownerRoles.includes(requester.role)) {
      throw new ForbiddenException('Only ULB or STATE admin can transfer ownership');
    }

    const newOwner = await this.userModel
      .findOne({ _id: dto.newOwnerId, isDeleted: false })
      .select('role ulb state')
      .lean()
      .exec();

    if (!newOwner) throw new NotFoundException('New owner user not found');

    // new owner must be in the same ULB/state as the requester
    assertAdminSameScope(requester, newOwner);

    // new owner must currently be an editor or viewer — not already an admin
    const eligibleRoles = [
      UserRole.ULB_EDITOR,
      UserRole.ULB_VIEWER,
      UserRole.STATE_EDITOR,
      UserRole.STATE_VIEWER,
    ] as string[];
    if (!eligibleRoles.includes(newOwner.role as string)) {
      throw new BadRequestException('New owner must currently be an EDITOR or VIEWER role');
    }

    // demoteTo must match the requester's scope
    const ulbDemotionRoles = [UserRole.ULB_EDITOR, UserRole.ULB_VIEWER] as string[];
    const stateDemotionRoles = [UserRole.STATE_EDITOR, UserRole.STATE_VIEWER] as string[];

    if (requester.role === UserRole.ULB && !ulbDemotionRoles.includes(dto.demoteTo)) {
      throw new BadRequestException('ULB admin can only demote to ULB-EDITOR or ULB-VIEWER');
    }
    if (requester.role === UserRole.STATE && !stateDemotionRoles.includes(dto.demoteTo)) {
      throw new BadRequestException('STATE admin can only demote to STATE-EDITOR or STATE-VIEWER');
    }

    // atomic swap inside a MongoDB session
    const session = await this.userModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        await this.userModel.findByIdAndUpdate(dto.newOwnerId, { $set: { role: requester.role } }, { session });
        await this.userModel.findByIdAndUpdate(requester._id, { $set: { role: dto.demoteTo } }, { session });
      });
    } finally {
      await session.endSession();
    }

    return { message: 'Ownership transferred successfully' };
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

    if (!isSelfUpdate) {
      assertAdminSameScope(requester, targetUser);
    } else if (!isUlbScope) {
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

  /**
   * Returns the permission matrix rows for the requester's scope.
   * Used only for UI display — not a security decision.
   */
  getPermissionMatrix(requester: AuthUser): PermissionMatrixRow[] {
    return requester.scope === Scope.STATE ? STATE_MATRIX : ULB_MATRIX;
  }

  async getProfileContacts(id: string): Promise<ProfileContactsResponseDto> {
    const user = await this.userModel
      .findById(id)
      .select(
        'commissionerName commissionerEmail commissionerConatactNumber accountantName accountantEmail accountantConatactNumber',
      )
      .lean()
      .exec();

    if (!user) throw new NotFoundException('User not found');

    return {
      commissionerName: user.commissionerName ?? '',
      commissionerEmail: user.commissionerEmail ?? '',
      commissionerConatactNumber: user.commissionerConatactNumber ?? '',
      accountantName: user.accountantName ?? '',
      accountantEmail: user.accountantEmail ?? '',
      accountantConatactNumber: user.accountantConatactNumber ?? '',
    };
  }
}

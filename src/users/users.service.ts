/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from '../schemas/ulb.schema';
import { State, StateDocument } from '../schemas/state.schema';
import { MANAGED_ROLES, ManagedRole, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListTeamMembersQueryDto } from './dto/list-team-members-query.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdatePermissionOverridesDto } from './dto/update-permission-overrides.dto';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import {
  assertAdminSameScope,
  assertManageableTarget,
  buildScopedQuery,
  resolveAdminScopeTarget,
} from './user-scope.helpers';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { RedisService } from 'src/core/services/redis/redis.service';
import { SmsService } from 'src/core/services/sms/sms.service';

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
  { label: 'View status and reports',  permissionKey: Permission.VIEW_STATUS_REPORTS,      submitter: true,  editor: true,  viewer: true  },
  { label: 'Upload documents',         permissionKey: Permission.UPLOAD_DOCUMENTS,          submitter: true,  editor: true,  viewer: false },
  { label: 'Message users',            permissionKey: Permission.MESSAGE_USERS,             submitter: true,  editor: true,  viewer: false },
  { label: 'Final submit to State DMA',permissionKey: Permission.FINAL_SUBMIT_TO_STATE_DMA, submitter: true,  editor: false, viewer: false },
  { label: 'Manage users',             permissionKey: Permission.MANAGE_USERS,              submitter: true,  editor: false, viewer: false },
];

const STATE_MATRIX: PermissionMatrixRow[] = [
  { label: 'View status and reports',       permissionKey: Permission.VIEW_STATUS_REPORTS,          submitter: true,  editor: true,  viewer: true  },
  { label: 'View dashboards',               permissionKey: Permission.VIEW_DASHBOARDS,              submitter: true,  editor: true,  viewer: true  },
  { label: 'Upload state-level documents',  permissionKey: Permission.UPLOAD_STATE_LEVEL_DOCUMENTS, submitter: true,  editor: true,  viewer: false },
  { label: 'Review ULB submissions',        permissionKey: Permission.REVIEW_ULB_SUBMISSIONS,       submitter: true,  editor: true,  viewer: false },
  { label: 'Message users',                 permissionKey: Permission.MESSAGE_USERS,                submitter: true,  editor: true,  viewer: false },
  { label: 'Approve ULB submissions',       permissionKey: Permission.APPROVE_ULB_SUBMISSIONS,      submitter: true,  editor: false, viewer: false },
  { label: 'Prepare grant letters',         permissionKey: Permission.PREPARE_GRANT_LETTERS,        submitter: true,  editor: false, viewer: false },
  { label: 'Recommend exemptions',          permissionKey: Permission.RECOMMEND_EXEMPTIONS,         submitter: true,  editor: false, viewer: false },
  { label: 'Final submit to MoHUA',         permissionKey: Permission.FINAL_SUBMIT_TO_MOHUA,        submitter: true,  editor: false, viewer: false },
  { label: 'Manage users',                  permissionKey: Permission.MANAGE_USERS,                 submitter: true,  editor: false, viewer: false },
];

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  /** Max number of resend-invite calls per target user within the rate-limit window. */
  private static readonly RESEND_INVITE_MAX = 3;
  /** Rate-limit window in seconds for resend-invite (1 hour). */
  private static readonly RESEND_INVITE_WINDOW_SECS = 3600;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Ulb.name) private ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private stateModel: Model<StateDocument>,
    private readonly redisService: RedisService,
    private readonly smsService: SmsService,
  ) {}

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

    // if (dto.email) {
    //   const emailExists = await this.userModel.exists({
    //     email: dto.email,
    //     isDeleted: false,
    //   });

    //   if (emailExists) {
    //     throw new BadRequestException('Email already registered');
    //   }
    // }

    // if (dto.username) {
    //   const usernameExists = await this.userModel.exists({
    //     username: dto.username,
    //     isDeleted: false,
    //   });

    //   if (usernameExists) {
    //     throw new BadRequestException('Username already registered');
    //   }
    // }

    const pendingStatus = dto.status ?? 'PENDING';
    const createPayload: Record<string, unknown> = {
      name: dto.name,
      username: dto.username,
      ...(dto.email && { email: dto.email }),
      mobile: dto.mobile,
      role: dto.role,
      subRole: this.deriveSubRole(dto.role),
      designation: dto.designation ?? '',
      status: pendingStatus,
      password: 'UNSET',
      isActive: false,
      isXVIFCProfileVerified: false,
      createdBy: new Types.ObjectId(creatorId),
      ...(targetStateId && { state: new Types.ObjectId(targetStateId) }),
      ...(targetUlbId && { ulb: new Types.ObjectId(targetUlbId) }),
      // Track invite time so the frontend can show the 48-hour expiry countdown
      ...(pendingStatus === 'PENDING' && { invitedAt: new Date() }),
    };

    const user = await this.userModel.create(createPayload);
    const obj = user.toObject() as unknown as Record<string, unknown>;
    delete obj.password;
    delete obj.refreshTokenHash;
    return obj;
  }

  /**
   * Resends an invite to a pending managed user.
   *
   * Rules:
   *  - Target must be PENDING and not yet active.
   *  - Requester must have MANAGE_USERS permission and be in the same scope.
   *  - Max 3 resends per target user per hour (Redis-backed rate limit).
   *  - Resets invitedAt so the 48-hour expiry window starts fresh.
   *  - Sends an SMS notification (best-effort: SMS failure does not fail the request).
   */
  async resendInvite(targetUserId: string, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('name mobile role ulb state status isActive')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    // Scope enforcement: requester can only resend to users in their own ULB/state.
    assertManageableTarget(requester, targetUser);

    // Only PENDING, not-yet-active users can receive a resend.
    if (targetUser.status !== 'PENDING' || targetUser.isActive) {
      throw new BadRequestException('Invite can only be resent to users who are still pending activation');
    }

    if (!targetUser.mobile) {
      throw new BadRequestException('User has no mobile number on record — cannot resend invite');
    }

    // Rate limit: max 3 re-sends per hour per target user to prevent SMS flooding.
    // INCR is atomic; EXPIRE is fire-and-forget to avoid permanently-stuck keys if
    // the call fails. Worst case: the key has no TTL and clears on next Redis restart —
    // still safe because the count is already persisted and blocks further resends.
    const rateLimitKey = `invite:resend:${targetUserId}`;
    let current: number;
    try {
      current = await this.redisService.incr(rateLimitKey);
      if (current === 1) {
        this.redisService
          .expire(rateLimitKey, UsersService.RESEND_INVITE_WINDOW_SECS)
          .catch((err: unknown) =>
            this.logger.error(`Failed to set TTL on rate-limit key "${rateLimitKey}" — key may persist without expiry`, err),
          );
      }
    } catch (err) {
      this.logger.error('Redis unavailable during resend-invite rate-limit check — failing closed', err);
      throw new HttpException('Service temporarily unavailable. Please try again shortly.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (current > UsersService.RESEND_INVITE_MAX) {
      throw new HttpException(
        `Invite resend limit reached. Maximum ${UsersService.RESEND_INVITE_MAX} resends per hour.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Reset invitedAt — gives the pending user a fresh 48-hour window.
    await this.userModel.findByIdAndUpdate(targetUserId, { $set: { invitedAt: new Date() } }).exec();

    // Send SMS notification — failure is logged but does not fail the request.
    await this.smsService.sendInviteReminder(targetUser.mobile, targetUser.name);

    this.logger.log(`Invite resent to user ${targetUserId} by requester ${requester._id}`);

    return { message: `Invite resent to ${targetUser.name}` };
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
  ): Promise<{ message: string; overrides: { allow: Permission[]; deny: Permission[] }; effectivePermissions: Permission[] }> {
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
      throw new BadRequestException(
        `These permissions appear in both allow and deny: ${conflict.join(', ')}`,
      );
    }

    await this.userModel
      .findByIdAndUpdate(targetUserId, { $set: { 'permissionOverrides.allow': allow, 'permissionOverrides.deny': deny } })
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

  async updateUserRole(targetUserId: string, dto: UpdateUserRoleDto, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(targetUserId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel
      .findOne({ _id: targetUserId, isDeleted: false })
      .select('role ulb state')
      .lean()
      .exec();

    if (!targetUser) throw new NotFoundException('User not found');

    assertManageableTarget(requester, targetUser);

    // Defense-in-depth: DTO already restricts to MANAGED_ROLES, but guard here
    // in case the method is ever called programmatically without a validated DTO.
    if (!(MANAGED_ROLES as readonly string[]).includes(dto.role)) {
      throw new BadRequestException(`role must be one of: ${MANAGED_ROLES.join(', ')}`);
    }

    const newSubRole = this.deriveSubRole(dto.role);
    const isLegacyMainRole = ['STATE', 'ULB'].includes((targetUser.role as string ?? '').toUpperCase());

    if (isLegacyMainRole) {
      // Legacy STATE/ULB accounts must never have their role changed — it would break old portals.
      // Only update subRole to reflect the new XVI-FC designation.
      await this.userModel.findByIdAndUpdate(targetUserId, { $set: { subRole: newSubRole } }).exec();
    } else {
      await this.userModel.findByIdAndUpdate(targetUserId, { $set: { role: dto.role, subRole: newSubRole } }).exec();
    }

    return { message: 'User role updated successfully' };
  }

  async transferOwnership(dto: TransferOwnershipDto, requester: AuthUser): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(dto.newOwnerId)) throw new BadRequestException('Invalid newOwnerId');

    const ownerRoles = [UserRole.ULB, UserRole.STATE] as string[];
    if (requester.role !== UserRole.ADMIN && !ownerRoles.includes(requester.role)) {
      throw new ForbiddenException('Only ULB or STATE admin can transfer ownership');
    }

    // Only the current submitter may initiate a transfer
    if (requester.role !== UserRole.ADMIN && requester.subRole !== 'submitter') {
      throw new ForbiddenException('Only the current submitter can transfer ownership');
    }

    const newOwner = await this.userModel
      .findOne({ _id: dto.newOwnerId, isDeleted: false })
      .select('role ulb state subRole isXVIFCProfileVerified')
      .lean()
      .exec();

    if (!newOwner) throw new NotFoundException('New owner user not found');

    assertAdminSameScope(requester, newOwner);

    // New owner must have completed their own XVI-FC profile verification before they can receive ownership.
    if (!newOwner.isXVIFCProfileVerified) {
      throw new BadRequestException('New owner must complete profile verification before receiving ownership');
    }

    // New owner must be an editor or viewer (not already a submitter or unverified legacy user).
    // For STATE legacy users (role=STATE), we check subRole explicitly since their role never changes.
    const managedEditorViewerRoles = MANAGED_ROLES as readonly string[];
    const isLegacyStateUser = (newOwner.role as string).toUpperCase() === 'STATE';
    const isEligible =
      managedEditorViewerRoles.includes(newOwner.role as string) ||
      (isLegacyStateUser && !!newOwner.subRole && newOwner.subRole !== 'submitter');

    if (!isEligible) {
      throw new BadRequestException('New owner must currently be an editor or viewer');
    }

    const ulbDemotionRoles = [UserRole.ULB_EDITOR, UserRole.ULB_VIEWER] as string[];
    const stateDemotionRoles = [UserRole.STATE_EDITOR, UserRole.STATE_VIEWER] as string[];

    if (requester.role === UserRole.ULB && !ulbDemotionRoles.includes(dto.demoteTo)) {
      throw new BadRequestException('ULB admin can only demote to ULB-EDITOR or ULB-VIEWER');
    }
    if (requester.role === UserRole.STATE && !stateDemotionRoles.includes(dto.demoteTo)) {
      throw new BadRequestException('STATE admin can only demote to STATE-EDITOR or STATE-VIEWER');
    }

    const requesterNewSubRole = this.deriveSubRole(dto.demoteTo);
    const isStateScope = requester.role === UserRole.STATE;

    const session = await this.userModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        if (isStateScope) {
          // STATE: legacy role field must never change — only swap subRole.
          await this.userModel.findByIdAndUpdate(dto.newOwnerId, { $set: { subRole: 'submitter' } }, { session });
          // Clear refresh token so the old submitter is force-logged-out on all other sessions.
          await this.userModel.findByIdAndUpdate(requester._id, { $set: { subRole: requesterNewSubRole, refreshTokenHash: null } }, { session });
        } else {
          // ULB: swap role + subRole for both parties.
          await this.userModel.findByIdAndUpdate(dto.newOwnerId, { $set: { role: requester.role, subRole: 'submitter' } }, { session });
          // Clear refresh token so the old submitter is force-logged-out on all other sessions.
          await this.userModel.findByIdAndUpdate(requester._id, { $set: { role: dto.demoteTo, subRole: requesterNewSubRole, refreshTokenHash: null } }, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    return { message: 'Ownership transferred successfully' };
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().limit(10).exec();
  }

  async findOne(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    return this.userModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async remove(id: string): Promise<User | null> {
    return this.userModel.findByIdAndDelete(id).exec();
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

  async updateProfileContacts(userId: string, dto: UpdateProfileContactsDto, requester: AuthUser): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid user ID');

    const targetUser = await this.userModel.findOne({ _id: userId, isDeleted: false }).select('ulb state role subRole').lean().exec();
    if (!targetUser) throw new NotFoundException('User not found');

    assertAdminSameScope(requester, targetUser);

    const unknown = Object.keys(dto).filter((k) => !UsersService.UPDATABLE_FIELDS.has(k));
    if (unknown.length) throw new BadRequestException(`Field(s) not updatable: ${unknown.join(', ')}`);

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) update[key] = value;
    }

    // STATE accounts use email as their login credential — never allow it to be overwritten.
    const targetRole = (targetUser.role as string ?? '').toUpperCase();
    if (targetRole === 'STATE' || targetRole === 'STATE-EDITOR' || targetRole === 'STATE-VIEWER') {
      delete update['email'];
    }

    if (!Object.keys(update).length) throw new BadRequestException('No fields provided to update');

    // When marking a user as XVI-FC profile verified for the first time, assign their subRole.
    if (update['isXVIFCProfileVerified'] === true && !targetUser.subRole) {
      const isStateScope = targetRole === 'STATE' || targetRole.startsWith('STATE');
      const isUlbScope = targetRole === 'ULB' || targetRole.startsWith('ULB');

      if (isStateScope) {
        // First-verifier-wins: the check and write must be atomic so two simultaneous verify
        // requests cannot both read "no submitter exists" and both claim the submitter slot.
        let assignedSubRole: 'submitter' | 'viewer';
        const session = await this.userModel.db.startSession();
        try {
          await session.withTransaction(async () => {
            const alreadyHasSubmitter = await this.userModel
              .findOne(
                { state: targetUser.state, subRole: 'submitter', _id: { $ne: new Types.ObjectId(userId) }, isDeleted: false },
                null,
                { session },
              )
              .select('_id')
              .lean()
              .exec();
            assignedSubRole = alreadyHasSubmitter ? 'viewer' : 'submitter';
            await this.userModel
              .findByIdAndUpdate(userId, { $set: { ...update, subRole: assignedSubRole } }, { session })
              .exec();
          });
        } finally {
          await session.endSession();
        }
        return { message: 'Profile contacts updated successfully', updatedFields: { ...update, subRole: assignedSubRole! } };
      }

      if (isUlbScope) {
        update['subRole'] = 'submitter';
      }
    }

    await this.userModel.findByIdAndUpdate(userId, { $set: update }).exec();
    return { message: 'Profile contacts updated successfully', updatedFields: update };
  }

  private mapRole(user: { role: string; subRole?: string | null }): string {
    if (user.subRole) return user.subRole;
    const r = (user.role ?? '').toUpperCase();
    if (r.includes('EDITOR')) return 'editor';
    if (r.includes('VIEWER')) return 'viewer';
    if (r === 'ULB' || r === 'STATE') return 'submitter';
    return user.role;
  }

  private deriveSubRole(role: string): 'editor' | 'viewer' | 'submitter' {
    const r = role.toUpperCase();
    if (r.includes('EDITOR')) return 'editor';
    if (r.includes('VIEWER')) return 'viewer';
    return 'submitter';
  }

  /**
   * Lists users for the ULB or STATE that the requesting user belongs to.
   * Scope is enforced server-side — the requester cannot query another ULB/state.
   */
  async listUsers(
    query: ListUsersQueryDto,
    requester: AuthUser,
  ): Promise<{
    ulbDetails?: Record<string, unknown>;
    stateDetails?: Record<string, unknown>;
    data: Record<string, unknown>[];
  }> {
    query = buildScopedQuery(requester, query);

    if (!query.stateId && !query.ulbId) {
      throw new BadRequestException('Provide either stateId or ulbId');
    }

    if (query.ulbId && !Types.ObjectId.isValid(query.ulbId)) {
      throw new BadRequestException('Invalid ulbId');
    }

    if (query.stateId && !Types.ObjectId.isValid(query.stateId)) {
      throw new BadRequestException('Invalid stateId');
    }

    const filter: FilterQuery<User> = {
      isDeleted: query.showDeleted === false,
    };

    let ulbDetails: Record<string, unknown> | undefined;
    let stateDetails: Record<string, unknown> | undefined;

    /**
     * Case 1: ULB-wise listing
     */
    if (query.ulbId) {
      filter.ulb = new Types.ObjectId(query.ulbId);

      const ulb = await this.ulbModel
        .findById(query.ulbId)
        .populate<{ state: { name: string; code?: string } }>('state', 'name code')
        .lean()
        .exec();

      if (ulb) {
        ulbDetails = {
          name: ulb.name,
          code: ulb.code ?? '',
          stateName: ulb.state?.name ?? '',
        };
      }
    }

    /**
     * Case 2: State-wise listing
     *
     * Only lists STATE-level users, not all ULB users inside that state.
     */
    if (!query.ulbId && query.stateId) {
      filter.state = new Types.ObjectId(query.stateId);
      filter.role = {
        $in: [Role.STATE, Role.STATE_EDITOR, Role.STATE_VIEWER],
      };

      const state = await this.stateModel.findById(query.stateId).select('name code').lean().exec();

      if (state) {
        stateDetails = {
          name: state.name,
          code: state.code ?? '',
        };
      }
    }

    const users = await this.userModel
      .find(filter)
      .select(
        [
          'name',
          'designation',
          'mobile',
          'email',
          'role',
          'subRole',
          'status',
          'isActive',
          'isXVIFCProfileVerified',

          'accountantName',
          'accountantEmail',
          'accountantConatactNumber',

          'commissionerName',
          'commissionerEmail',
          'commissionerConatactNumber',

          'departmentName',
          'departmentEmail',
          'departmentContactNumber',
        ].join(' '),
      )
      .lean()
      .exec();

    /**
     * Final response array.
     */
    const result: Record<string, unknown>[] = [];

    /**
     * Used for dedupe.
     */
    const seenMobiles = new Set<string>();
    const seenNameMobileKeys = new Set<string>();

    /**
     * This map stores real user accounts by mobile.
     *
     * Priority:
     * user.mobile is more trusted than old contact fields.
     */
    const realUserByMobile = new Map<string, Record<string, unknown>>();

    /**
     * Separate actual user documents from old embedded contacts.
     */
    const mainRoleUsers = users.filter((u) => u.role === Role.ULB || u.role === Role.STATE);

    const managedUsers = users.filter((u) => u.role !== Role.ULB && u.role !== Role.STATE);

    // Step 1: Populate real-user-by-mobile map (managed users win over main-role users)
    for (const user of users) {
      const normalizedMobile = this.normalizeMobile(user.mobile);
      if (!normalizedMobile) continue;

      const formattedUser = this.formatActualUser(user);

      /**
       * If same mobile exists in multiple documents, prefer the most specific user account.
       *
       * Priority:
       * 1. Managed user - EDITOR / VIEWER
       * 2. Main user - ULB / STATE
       */
      const existing = realUserByMobile.get(normalizedMobile);

      if (!existing) {
        realUserByMobile.set(normalizedMobile, formattedUser);
        continue;
      }

      const existingRole = existing['rawRole'] as string | undefined;
      const existingIsMainRole = existingRole === Role.ULB || existingRole === Role.STATE;
      const currentIsManagedRole = user.role !== Role.ULB && user.role !== Role.STATE;

      if (existingIsMainRole && currentIsManagedRole) {
        realUserByMobile.set(normalizedMobile, formattedUser);
      }
    }

    // Step 2: Managed users first (EDITOR / VIEWER)
    for (const user of managedUsers) {
      const normalizedMobile = this.normalizeMobile(user.mobile);
      const normalizedName = this.normalizeText(user.name);
      const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

      if (normalizedMobile && seenMobiles.has(normalizedMobile)) continue;
      if (!normalizedMobile && seenNameMobileKeys.has(nameMobileKey)) continue;

      if (normalizedMobile) seenMobiles.add(normalizedMobile);
      seenNameMobileKeys.add(nameMobileKey);

      result.push(this.removeInternalFields(this.formatActualUser(user)));
    }

    // Step 3: Main ULB / STATE submitter accounts
    for (const user of mainRoleUsers) {
      const normalizedMobile = this.normalizeMobile(user.mobile);
      const normalizedName = this.normalizeText(user.name);
      const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

      if (normalizedMobile && seenMobiles.has(normalizedMobile)) continue;
      if (!normalizedMobile && seenNameMobileKeys.has(nameMobileKey)) continue;

      if (normalizedMobile) seenMobiles.add(normalizedMobile);
      seenNameMobileKeys.add(nameMobileKey);

      result.push(this.removeInternalFields(this.formatActualUser(user)));
    }

    // Step 4: Legacy embedded contacts — only shown when no real user shares the mobile
    for (const user of mainRoleUsers) {
      const legacyContacts = this.extractLegacyContacts(user);

      for (const contact of legacyContacts) {
        const normalizedName = this.normalizeText(contact.name);
        const normalizedMobile = this.normalizeMobile(contact.mobile);

        if (!normalizedName && !normalizedMobile) continue;

        // Skip if this contact is the same person as an existing real user account
        // (matched by both mobile AND name). If names differ, the mobile collision is
        // a data quirk (e.g. a shared number) — still surface the contact so the admin
        // can see and invite them.
        if (normalizedMobile && realUserByMobile.has(normalizedMobile)) {
          const realUser = realUserByMobile.get(normalizedMobile)!;
          const realUserNormalizedName = this.normalizeText(realUser['name'] as string);
          if (realUserNormalizedName === normalizedName) continue;
        }

        const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

        if (normalizedMobile && seenMobiles.has(normalizedMobile)) {
          // A real user already has this mobile (added in Steps 2/3). The name-match
          // check above already skipped contacts that are the same person. If we reach
          // here, names differ — still allow this legacy contact through. Only skip if
          // another legacy contact with the same mobile was already pushed to result.
          const alreadyAsLegacy = result.some(
            (item) =>
              item['isLegacyContact'] === true &&
              this.normalizeMobile(item['mobile'] as string) === normalizedMobile,
          );
          if (alreadyAsLegacy) continue;
        }
        if (!normalizedMobile && seenNameMobileKeys.has(nameMobileKey)) continue;

        const alreadyExistsByName = result.some(
          (item) => this.normalizeText(item['name'] as string) === normalizedName && normalizedName !== '',
        );
        if (!normalizedMobile && alreadyExistsByName) continue;

        if (normalizedMobile) seenMobiles.add(normalizedMobile);
        seenNameMobileKeys.add(nameMobileKey);

        result.push({
          name: contact.name?.trim() || '',
          designation: contact.designation?.trim() || '',
          email: contact.email?.trim() || '',
          mobile: contact.mobile?.trim() || '',
          source: contact.source,
          isLegacyContact: true,
        });
      }
    }

    return {
      ...(ulbDetails && { ulbDetails }),
      ...(stateDetails && { stateDetails }),
      data: result,
    };
  }

  /**
   * Lists real user accounts for the team management view.
   * Never returns legacy embedded contacts — only actual user documents.
   *
   * ULB scope  → all roles belonging to that ULB (ULB, ULB-EDITOR, ULB-VIEWER)
   * State scope → only STATE / STATE_EDITOR / STATE_VIEWER to avoid returning
   *               the 100+ ULB users that also carry the same state reference.
   *
   * Scope enforcement is delegated to buildScopedQuery — same rules as listUsers.
   */
  async listTeamMembers(
    query: ListTeamMembersQueryDto,
    requester: AuthUser,
  ): Promise<{
    ulbDetails?: Record<string, unknown>;
    stateDetails?: Record<string, unknown>;
    data: Record<string, unknown>[];
  }> {
    // Reuse the existing scope-enforcement helper — handles ADMIN passthrough,
    // ULB↔STATE cross-scope blocks, mismatched IDs, both params together, null scope.
    const scoped = buildScopedQuery(requester, { ulbId: query.ulbId, stateId: query.stateId });

    if (!scoped.ulbId && !scoped.stateId) {
      throw new BadRequestException('Provide either ulbId or stateId');
    }

    if (scoped.ulbId && !Types.ObjectId.isValid(scoped.ulbId)) {
      throw new BadRequestException('Invalid ulbId');
    }

    if (scoped.stateId && !Types.ObjectId.isValid(scoped.stateId)) {
      throw new BadRequestException('Invalid stateId');
    }

    const filter: FilterQuery<User> = { isDeleted: false };

    let ulbDetails: Record<string, unknown> | undefined;
    let stateDetails: Record<string, unknown> | undefined;

    if (scoped.ulbId) {
      filter.ulb = new Types.ObjectId(scoped.ulbId);

      const ulb = await this.ulbModel
        .findById(scoped.ulbId)
        .populate<{ state: { name: string } }>('state', 'name')
        .lean()
        .exec();

      if (ulb) {
        ulbDetails = { name: ulb.name, code: ulb.code ?? '', stateName: ulb.state?.name ?? '' };
      }
    } else {
      // Role filter is mandatory for state scope — prevents returning 100+ ULB users
      // that also store the same stateId on their documents.
      filter.state = new Types.ObjectId(scoped.stateId);
      filter.role = { $in: [Role.STATE, Role.STATE_EDITOR, Role.STATE_VIEWER] };

      const state = await this.stateModel.findById(scoped.stateId).select('name code').lean().exec();
      if (state) {
        stateDetails = { name: state.name, code: state.code ?? '' };
      }
    }

    const users = await this.userModel
      .find(filter)
      .select('name designation email mobile role subRole status isActive isXVIFCProfileVerified lastLoginAt invitedAt')
      .lean()
      .exec();

    const roleOrder: Record<string, number> = { submitter: 0, editor: 1, viewer: 2 };
    const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

    const data = users
      .map((u) => ({
        _id: u._id.toString(),
        name: u.name?.trim() || '',
        designation: u.designation?.trim() || '',
        email: u.email?.trim() || '',
        mobile: (u.mobile ?? '').trim(),
        role: this.mapRole(u),
        subRole: u.subRole ?? null,
        status: u.status ?? '',
        isActive: u.isActive ?? false,
        isXVIFCProfileVerified: u.isXVIFCProfileVerified ?? false,
        lastLoginAt: u.lastLoginAt ?? null,
        invitedAt: u.invitedAt ?? null,
        isInviteExpired: u.invitedAt ? Date.now() - new Date(u.invitedAt).getTime() > INVITE_EXPIRY_MS : false,
      }))
      .sort((a, b) => {
        const roleDiff = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
        if (roleDiff !== 0) return roleDiff;
        return a.name.localeCompare(b.name);
      });

    return {
      ...(ulbDetails && { ulbDetails }),
      ...(stateDetails && { stateDetails }),
      data,
    };
  }

  /**
   * Returns the permission matrix rows for the requester's scope.
   * Used only for UI display — not a security decision.
   */
  getPermissionMatrix(requester: AuthUser): PermissionMatrixRow[] {
    return requester.scope === Scope.STATE ? STATE_MATRIX : ULB_MATRIX;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private normalizeText(value?: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  }

  private normalizeMobile(value?: unknown): string {
    if (value === null || value === undefined) return '';

    const digitsOnly = String(value).replace(/\D/g, '');

    // Strip Indian country code: 919414033122 → 9414033122
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      return digitsOnly.slice(2);
    }

    return digitsOnly;
  }

  private formatActualUser(user: Record<string, any>): Record<string, unknown> {
    return {
      _id: user._id?.toString() ?? '',
      name: user.name?.trim() || '',
      designation: user.designation?.trim() || '',
      email: user.email?.trim() || '',
      mobile: user.mobile?.trim() || '',
      role: this.mapRole(user as { role: string; subRole?: string | null }),
      subRole: user.subRole ?? null,
      rawRole: user.role,
      status: user.status ?? '',
      isActive: user.isActive ?? false,
      isXVIFCProfileVerified: user.isXVIFCProfileVerified ?? false,
      isLegacyContact: false,
    };
  }

  private removeInternalFields(item: Record<string, unknown>): Record<string, unknown> {
    const cleaned = { ...item }
    delete cleaned['rawRole'];
    return cleaned;
  }

  private extractLegacyContacts(user: Record<string, any>): Array<{
    name?: string;
    email?: string;
    mobile?: string;
    designation?: string;
    source: 'accountant' | 'commissioner' | 'department';
  }> {
    return [
      {
        name: user.accountantName,
        email: user.accountantEmail,
        mobile: user.accountantConatactNumber,
        designation: 'Accountant',
        source: 'accountant',
      },
      {
        name: user.commissionerName,
        email: user.commissionerEmail,
        mobile: user.commissionerConatactNumber,
        designation: 'Commissioner',
        source: 'commissioner',
      },
      {
        name: user.departmentName,
        email: user.departmentEmail,
        mobile: user.departmentContactNumber,
        designation: 'Department',
        source: 'department',
      },
    ];
  }

  async findUserContacts(
    id: string,
  ): Promise<{ name: string; designation: string; email?: string; mobile?: string }[]> {
    const user = await this.userModel
      .findById(id)
      .select(
        'name designation mobile email accountantName accountantEmail accountantConatactNumber commissionerName commissionerEmail commissionerConatactNumber departmentName departmentEmail departmentContactNumber',
      )
      .lean()
      .exec();

    if (!user) return [];

    const groups = [
      { name: user.name, email: user.email, mobile: user.mobile, designation: user.designation },
      { name: user.accountantName, email: user.accountantEmail, mobile: user.accountantConatactNumber, designation: '' },
      { name: user.commissionerName, email: user.commissionerEmail, mobile: user.commissionerConatactNumber, designation: '' },
      { name: user.departmentName, email: user.departmentEmail, mobile: user.departmentContactNumber, designation: '' },
    ];

    const seen = new Set<string>();

    return groups
      .filter((g) => g.name?.trim())
      .reduce<{ name: string; designation: string; email?: string; mobile?: string }[]>((acc, g) => {
        const dedupeKey = `${g.name?.trim().toLowerCase()}|${g.mobile?.trim() ?? ''}`;
        if (seen.has(dedupeKey)) return acc;
        seen.add(dedupeKey);

        const entry: { name: string; designation: string; email?: string; mobile?: string } = {
          name: g.name,
          designation: g.designation?.trim() || '',
        };
        if (g.email?.trim()) entry.email = g.email;
        if (g.mobile?.trim()) entry.mobile = g.mobile;
        acc.push(entry);
        return acc;
      }, []);
  }
}

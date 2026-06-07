/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from 'src/admin/xvi-fc/schemas/ulb.schema';
import { State, StateDocument } from 'src/admin/xvi-fc/schemas/state.schema';
import { Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
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
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Ulb.name) private ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private stateModel: Model<StateDocument>,
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
    const eligibleRoles = [UserRole.ULB_EDITOR, UserRole.ULB_VIEWER, UserRole.STATE_EDITOR, UserRole.STATE_VIEWER] as string[];
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

    const targetUser = await this.userModel.findOne({ _id: userId, isDeleted: false }).select('ulb state').lean().exec();
    if (!targetUser) throw new NotFoundException('User not found');

    assertAdminSameScope(requester, targetUser);

    const unknown = Object.keys(dto).filter((k) => !UsersService.UPDATABLE_FIELDS.has(k));
    if (unknown.length) throw new BadRequestException(`Field(s) not updatable: ${unknown.join(', ')}`);

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) update[key] = value;
    }
    if (!Object.keys(update).length) throw new BadRequestException('No fields provided to update');

    await this.userModel.findByIdAndUpdate(userId, { $set: update }).exec();
    return { message: 'Profile contacts updated successfully', updatedFields: update };
  }

  private mapRole(role: string): string {
    const r = (role ?? '').toUpperCase();
    if (r.includes('EDITOR')) return 'editor';
    if (r.includes('VIEWER')) return 'viewer';
    if (r === 'ULB' || r === 'STATE') return 'submitter';
    return role;
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
      isDeleted: query.showDeleted === true,
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

        // Skip if mobile belongs to a real active user document.
        // When showDeleted=true we're viewing archived data so we always include legacy contacts.
        if (!query.showDeleted && normalizedMobile && realUserByMobile.has(normalizedMobile)) continue;

        const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

        if (normalizedMobile && seenMobiles.has(normalizedMobile)) continue;
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
      role: this.mapRole(user.role),
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

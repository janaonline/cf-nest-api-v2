/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from 'src/admin/xvi-fc/schemas/ulb.schema';
import { State, StateDocument } from 'src/admin/xvi-fc/schemas/state.schema';
import { UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';

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
    const stateManagedRoles = [Role.STATE_EDITOR, Role.STATE_VIEWER] as string[];
    const ulbManagedRoles = [Role.ULB_EDITOR, Role.ULB_VIEWER] as string[];
    const adminRoles = [Role.STATE, Role.ULB] as string[];

    if (!adminRoles.includes(creator.role)) {
      throw new ForbiddenException('Only admin users can create managed users');
    }

    const creatorId = this.toObjectIdString(creator._id);
    const creatorStateId = this.toObjectIdString(creator.state);
    const creatorUlbId = this.toObjectIdString(creator.ulb);

    if (!creatorId || !Types.ObjectId.isValid(creatorId)) {
      throw new ForbiddenException('Invalid logged-in user');
    }

    let targetStateId: string | null = null;
    let targetUlbId: string | null = null;

    /**
     * STATE admin can create only STATE-EDITOR / STATE-VIEWER
     * and the new user belongs to the same state as the logged-in STATE admin.
     */
    if (creator.role === UserRole.STATE) {
      if (!stateManagedRoles.includes(dto.role)) {
        throw new ForbiddenException('STATE admin can create only STATE-EDITOR or STATE-VIEWER users');
      }

      if (!creatorStateId || !Types.ObjectId.isValid(creatorStateId)) {
        throw new ForbiddenException('Logged-in STATE admin is not mapped to any valid state');
      }

      if (dto.stateId && !Types.ObjectId.isValid(dto.stateId)) {
        throw new BadRequestException('Invalid stateId');
      }

      /**
       * If frontend sends stateId, it must match logged-in admin's state.
       */
      if (dto.stateId && dto.stateId !== creatorStateId) {
        throw new ForbiddenException('You cannot create users for another state');
      }

      /**
       * STATE admin should not create ULB users through this flow.
       */
      if (dto.ulbId) {
        throw new ForbiddenException('STATE admin cannot directly assign ULB while creating STATE users');
      }

      targetStateId = creatorStateId;
      targetUlbId = null;
    }

    /**
     * ULB admin can create only ULB-EDITOR / ULB-VIEWER
     * and the new user belongs to the same ULB as the logged-in ULB admin.
     */
    if (creator.role === UserRole.ULB) {
      if (!ulbManagedRoles.includes(dto.role)) {
        throw new ForbiddenException('ULB admin can create only ULB-EDITOR or ULB-VIEWER users');
      }

      if (!creatorUlbId || !Types.ObjectId.isValid(creatorUlbId)) {
        throw new ForbiddenException('Logged-in ULB admin is not mapped to any valid ULB');
      }

      if (dto.ulbId && !Types.ObjectId.isValid(dto.ulbId)) {
        throw new BadRequestException('Invalid ulbId');
      }

      /**
       * If frontend sends ulbId, it must match logged-in admin's ULB.
       */
      if (dto.ulbId && dto.ulbId !== creatorUlbId) {
        throw new ForbiddenException('You cannot create users for another ULB');
      }

      /**
       * If frontend sends stateId, it must match logged-in admin's state.
       */
      if (dto.stateId && creatorStateId && dto.stateId !== creatorStateId) {
        throw new ForbiddenException('You cannot create users for another state');
      }

      targetUlbId = creatorUlbId;

      if (creatorStateId && Types.ObjectId.isValid(creatorStateId)) {
        targetStateId = creatorStateId;
      }
    }

    const mobileExists = await this.userModel.exists({
      mobile: dto.mobile,
      isDeleted: false,
    });

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
    };

    if (targetStateId) {
      createPayload.state = new Types.ObjectId(targetStateId);
    }

    if (targetUlbId) {
      createPayload.ulb = new Types.ObjectId(targetUlbId);
    }

    const user = await this.userModel.create(createPayload);

    const obj = user.toObject() as unknown as Record<string, unknown>;

    delete obj.password;
    delete obj.refreshTokenHash;

    return obj;
  }
  private toObjectIdString(value: unknown): string | null {
    if (!value) return null;

    if (value instanceof Types.ObjectId) {
      return value.toString();
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
      const id = (value as { _id?: unknown })._id;

      if (id instanceof Types.ObjectId) {
        return id.toString();
      }

      if (typeof id === 'string') {
        return id;
      }
    }

    return null;
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

  async updateProfileContacts(userId: string, dto: UpdateProfileContactsDto): Promise<Record<string, unknown>> {
    const unknown = Object.keys(dto).filter((k) => !UsersService.UPDATABLE_FIELDS.has(k));
    if (unknown.length) throw new BadRequestException(`Field(s) not updatable: ${unknown.join(', ')}`);

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) update[key] = value;
    }
    if (!Object.keys(update).length) throw new BadRequestException('No fields provided to update');

    const updated = await this.userModel.findByIdAndUpdate(userId, { $set: update }, { new: true }).exec();
    if (!updated) throw new HttpException('User not found', 404);
    return { message: 'Profile contacts updated successfully', updatedFields: update };
  }

  private mapRole(role: string): string {
    const r = (role ?? '').toUpperCase();
    if (r.includes('EDITOR')) return 'editor';
    if (r.includes('VIEWER')) return 'viewer';
    if (r === 'ULB' || r === 'STATE') return 'submitter';
    return role;
  }

  async listUsers(query: ListUsersQueryDto): Promise<{
    ulbDetails?: Record<string, unknown>;
    stateDetails?: Record<string, unknown>;
    data: Record<string, unknown>[];
  }> {
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
      isDeleted: false,
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
     * This only lists STATE-level users, not all ULB users inside that state.
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

    /**
     * Step 1:
     * Add all actual user documents into mobile map.
     *
     * This includes:
     * - ULB / STATE submitter
     * - ULB-EDITOR / STATE-EDITOR
     * - ULB-VIEWER / STATE-VIEWER
     *
     * If any old contact has the same mobile later, it will be skipped.
     */
    for (const user of users) {
      const normalizedMobile = this.normalizeMobile(user.mobile);

      if (!normalizedMobile) {
        continue;
      }

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
      const currentRole = user.role;

      const existingIsMainRole = existingRole === Role.ULB || existingRole === Role.STATE;

      const currentIsManagedRole = currentRole !== Role.ULB && currentRole !== Role.STATE;

      if (existingIsMainRole && currentIsManagedRole) {
        realUserByMobile.set(normalizedMobile, formattedUser);
      }
    }

    /**
     * Step 2:
     * Push managed users first.
     *
     * This makes activated users appear before old submitter/legacy contacts.
     */
    for (const user of managedUsers) {
      const normalizedMobile = this.normalizeMobile(user.mobile);
      const normalizedName = this.normalizeText(user.name);
      const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

      if (normalizedMobile && seenMobiles.has(normalizedMobile)) {
        continue;
      }

      if (!normalizedMobile && seenNameMobileKeys.has(nameMobileKey)) {
        continue;
      }

      if (normalizedMobile) {
        seenMobiles.add(normalizedMobile);
      }

      seenNameMobileKeys.add(nameMobileKey);

      result.push(this.removeInternalFields(this.formatActualUser(user)));
    }

    /**
     * Step 3:
     * Push main ULB / STATE users.
     *
     * These are real submitter/admin accounts.
     */
    for (const user of mainRoleUsers) {
      const normalizedMobile = this.normalizeMobile(user.mobile);
      const normalizedName = this.normalizeText(user.name);
      const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

      if (normalizedMobile && seenMobiles.has(normalizedMobile)) {
        continue;
      }

      if (!normalizedMobile && seenNameMobileKeys.has(nameMobileKey)) {
        continue;
      }

      if (normalizedMobile) {
        seenMobiles.add(normalizedMobile);
      }

      seenNameMobileKeys.add(nameMobileKey);

      result.push(this.removeInternalFields(this.formatActualUser(user)));
    }

    /**
     * Step 4:
     * Expand old embedded contacts from main ULB / STATE documents.
     *
     * But before adding any old contact:
     *
     * - If contact mobile already exists as user.mobile in any real user document,
     *   skip old contact.
     *
     * - If contact was already added, skip duplicate.
     */
    for (const user of mainRoleUsers) {
      const legacyContacts = this.extractLegacyContacts(user);

      for (const contact of legacyContacts) {
        const normalizedName = this.normalizeText(contact.name);
        const normalizedMobile = this.normalizeMobile(contact.mobile);

        /**
         * No name and no mobile means useless contact.
         */
        if (!normalizedName && !normalizedMobile) {
          continue;
        }

        /**
         * Main important rule:
         *
         * If this contact number already exists as a real user.mobile,
         * do not show old contact.
         */
        if (normalizedMobile && realUserByMobile.has(normalizedMobile)) {
          continue;
        }

        const nameMobileKey = `${normalizedName}|${normalizedMobile}`;

        if (normalizedMobile && seenMobiles.has(normalizedMobile)) {
          continue;
        }

        if (!normalizedMobile && seenNameMobileKeys.has(nameMobileKey)) {
          continue;
        }

        /**
         * Optional fallback:
         * If mobile is missing but same name already shown, skip.
         * This avoids duplicate no-mobile legacy contacts.
         */
        const alreadyExistsByName = result.some(
          (item) => this.normalizeText(item['name'] as string) === normalizedName && normalizedName !== '',
        );

        if (!normalizedMobile && alreadyExistsByName) {
          continue;
        }

        if (normalizedMobile) {
          seenMobiles.add(normalizedMobile);
        }

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

  private normalizeText(value?: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim().toLowerCase();
  }
  private normalizeMobile(value?: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    /**
     * Converts:
     * " 94140 33122 "
     * "94140-33122"
     * "+91 9414033122"
     * into comparable number.
     */
    const digitsOnly = String(value).replace(/\D/g, '');

    /**
     * If Indian number with country code:
     * 919414033122 -> 9414033122
     */
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      return digitsOnly.slice(2);
    }

    return digitsOnly;
  }
  private formatActualUser(user: Record<string, any>): Record<string, unknown> {
    return {
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
    const cleaned = { ...item };

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
      {
        name: user.accountantName,
        email: user.accountantEmail,
        mobile: user.accountantConatactNumber,
        designation: '',
      },
      {
        name: user.commissionerName,
        email: user.commissionerEmail,
        mobile: user.commissionerConatactNumber,
        designation: '',
      },
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

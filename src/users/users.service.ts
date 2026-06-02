/* eslint-disable prettier/prettier */
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from 'src/admin/xvi-fc/schemas/ulb.schema';
import { State, StateDocument } from 'src/admin/xvi-fc/schemas/state.schema';
import { Role } from 'src/module/auth/enum/role.enum';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Ulb.name) private ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private stateModel: Model<StateDocument>,
  ) { }

  async create(data: Partial<User>): Promise<User> {
    const user = new this.userModel(data);
    return user.save();
  }

  async createManagedUser(dto: CreateManagedUserDto): Promise<Record<string, unknown>> {
    const stateRoles = [Role.STATE_EDITOR, Role.STATE_VIEWER] as string[];
    const ulbRoles = [Role.ULB_EDITOR, Role.ULB_VIEWER] as string[];

    if (stateRoles.includes(dto.role) && !dto.stateId) {
      throw new BadRequestException('stateId is required for STATE-EDITOR and STATE-VIEWER roles');
    }
    if (ulbRoles.includes(dto.role) && !dto.ulbId) {
      throw new BadRequestException('ulbId is required for ULB-EDITOR and ULB-VIEWER roles');
    }

    const mobileExists = await this.userModel.findOne({ mobile: dto.mobile, isDeleted: false }).exec();
    if (mobileExists) throw new BadRequestException('Mobile number already registered');

    const user = await this.userModel.create({
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
      ...(dto.ulbId && { ulb: new Types.ObjectId(dto.ulbId) }),
      ...(dto.stateId && { state: new Types.ObjectId(dto.stateId) }),
    });

    const obj = user.toObject() as unknown as Record<string, unknown>;
    delete obj['password'];
    delete obj['refreshTokenHash'];
    return obj;
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
    'name', 'email', 'mobile', 'username', 'designation', 'organization', 'address',
    'departmentName', 'departmentContactNumber', 'departmentEmail',
    'commissionerName', 'commissionerEmail', 'commissionerConatactNumber',
    'accountantName', 'accountantEmail', 'accountantConatactNumber',
    'status', 'isNodalOfficer', 'isXVIFCProfileVerified',
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

  async listUsers(query: ListUsersQueryDto): Promise<{ ulbDetails?: Record<string, unknown>; stateDetails?: Record<string, unknown>; data: Record<string, unknown>[] }> {
    if (!query.stateId && !query.ulbId) {
      throw new BadRequestException('Provide either stateId or ulbId');
    }

    const filter: FilterQuery<User> = { isDeleted: false };
    let ulbDetails: Record<string, unknown> | undefined;
    let stateDetails: Record<string, unknown> | undefined;

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
    } else if (query.stateId) {
      filter.state = new Types.ObjectId(query.stateId);
      filter.role = { $in: [Role.STATE, Role.STATE_EDITOR, Role.STATE_VIEWER] };

      const state = await this.stateModel.findById(query.stateId).select('name code').lean().exec();
      if (state) {
        stateDetails = { name: state.name, code: state.code ?? '' };
      }
    }

    const users = await this.userModel
      .find(filter)
      .select('name designation mobile email role status isXVIFCProfileVerified accountantName accountantEmail accountantConatactNumber commissionerName commissionerEmail commissionerConatactNumber departmentName departmentEmail departmentContactNumber')
      .lean()
      .exec();

    const seen = new Set<string>();
    const result: Record<string, unknown>[] = [];

    const mainRoleUsers = users.filter((u) => u.role === Role.ULB || u.role === Role.STATE);
    const managedUsers = users.filter((u) => u.role !== Role.ULB && u.role !== Role.STATE);

    // Process managed users first so their name|mobile key takes priority in deduplication
    for (const user of managedUsers) {
      const dedupeKey = `${user.name?.trim().toLowerCase()}|${user.mobile?.trim() ?? ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      result.push({
        name: user.name?.trim() || '',
        designation: user.designation?.trim() || '',
        email: user.email?.trim() || '',
        mobile: user.mobile?.trim() || '',
        role: this.mapRole(user.role),
        status: user.status ?? '',
        isXVIFCProfileVerified: user.isXVIFCProfileVerified ?? false,
      });
    }

    // Then expand main ULB/STATE users into sub-contacts; any already seen are skipped
    for (const user of mainRoleUsers) {
      const contacts = [
        { name: user.name, email: user.email, mobile: user.mobile, designation: user.designation, isMainUser: true },
        { name: user.accountantName, email: user.accountantEmail, mobile: user.accountantConatactNumber, designation: '', isMainUser: false },
        { name: user.commissionerName, email: user.commissionerEmail, mobile: user.commissionerConatactNumber, designation: '', isMainUser: false },
        { name: user.departmentName, email: user.departmentEmail, mobile: user.departmentContactNumber, designation: '', isMainUser: false },
      ];

      for (const contact of contacts) {
        if (!contact.name?.trim()) continue;
        const dedupeKey = `${contact.name.trim().toLowerCase()}|${contact.mobile?.trim() ?? ''}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const entry: Record<string, unknown> = {
          name: contact.name.trim(),
          designation: contact.designation?.trim() || '',
          email: contact.email?.trim() || '',
          mobile: contact.mobile?.trim() || '',
        };
        if (contact.isMainUser) {
          entry.role = this.mapRole(user.role);
          entry.status = user.status ?? '';
          entry.isXVIFCProfileVerified = user.isXVIFCProfileVerified ?? false;
        }
        result.push(entry);
      }
    }

    return { ...(ulbDetails && { ulbDetails }), ...(stateDetails && { stateDetails }), data: result };
  }

  async findUserContacts(id: string): Promise<{ name: string; designation: string; email?: string; mobile?: string }[]> {
    const user = await this.userModel
      .findById(id)
      .select('name designation mobile email accountantName accountantEmail accountantConatactNumber commissionerName commissionerEmail commissionerConatactNumber departmentName departmentEmail departmentContactNumber')
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

import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { PaginatedResult } from 'src/common/dto/pagination.dto';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { escapeRegex } from 'src/common/utils/regex.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import type { StateMemberResponseDto } from 'src/module/users/dto/state-member-response.dto';
import { AdcMemberForAdmin, UsersService } from 'src/module/users/users.service';
import { Adc, AdcDocument } from 'src/schemas/adc.schema';
import { AdcAuditAction } from 'src/schemas/adc-audit-log.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { AdcAuditLogService } from './audit/adc-audit-log.service';
import type { AdcListQueryDto } from './dto/adc-list-query.dto';
import type { CreateAdcDto } from './dto/create-adc.dto';
import type { RenameAdcDto } from './dto/rename-adc.dto';
import type { SetAdcAdminDto } from './dto/set-adc-admin.dto';

export interface AdcListItem {
  _id: Types.ObjectId;
  name: string;
  state: Types.ObjectId;
}

export interface AdcManageRow {
  _id: Types.ObjectId;
  name: string;
  state: { _id: Types.ObjectId; name: string | null };
  ulbCount: number;
  /** Active members, the Admin included. */
  memberCount: number;
  admin: { _id: Types.ObjectId; name: string; email: string; isXVIFCProfileVerified: boolean } | null;
}

type AdcLean = { _id: Types.ObjectId; name: string; state: Types.ObjectId; isActive?: boolean };

/** Same as UsersService's active ADC member filter, without the `adc` (the callers add it). */
const ACTIVE_ADC_MEMBER = { role: Role.STATE, isDeleted: false, isXviFcdeleted: { $ne: true } };

const adcNameExists = () =>
  new HttpException(
    { code: 'ADC_NAME_EXISTS', message: 'An ADC with this name already exists in this state.' },
    HttpStatus.CONFLICT,
  );

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

@Injectable()
export class AdcService {
  constructor(
    @InjectModel(Adc.name) private readonly adcModel: Model<AdcDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    private readonly usersService: UsersService,
    private readonly adcAuditLog: AdcAuditLogService,
  ) {}

  /**
   * Active ADCs for the pickers (Assign ADC, ADC Teams). ADMIN: the given state's, or every state's when no
   * state is passed. A State user (State DMA): always their own state's — the param is ignored. ADC users and
   * every other role: 403 (an ADC user never picks an ADC; theirs comes from their token).
   */
  async findAll(stateId: string | undefined, user: IAuthUser): Promise<AdcListItem[]> {
    const filter: Record<string, unknown> = { isActive: true };

    if (user.role === Role.ADMIN) {
      if (stateId) filter.state = new Types.ObjectId(stateId);
    } else if (user.role === Role.STATE && !user.adc) {
      if (!user.state) throw new ForbiddenException('Your account has no state assigned.');
      filter.state = new Types.ObjectId(String(user.state));
    } else {
      throw new ForbiddenException('You do not have access to the ADC list.');
    }

    return this.adcModel.find(filter, { name: 1, state: 1 }).sort({ name: 1 }).lean<AdcListItem[]>().exec();
  }

  // ─── Portal Admin: ADC management ─────────────────────────────────────────

  /** One page of ADCs with their counts and Admin. The counts come from batched queries over the page's ids. */
  async listForAdmin(query: AdcListQueryDto): Promise<PaginatedResult<AdcManageRow>> {
    const { page, limit } = query;
    const filter: FilterQuery<AdcDocument> = {};
    if (query.stateId) filter.state = new Types.ObjectId(query.stateId);
    if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: 'i' };

    const [adcs, total] = await Promise.all([
      this.adcModel
        .find(filter)
        .select('name state')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AdcLean[]>()
        .exec(),
      this.adcModel.countDocuments(filter).exec(),
    ]);
    const totalPages = Math.ceil(total / limit);
    if (!adcs.length) return { data: [], total, page, limit, totalPages };

    const ids = adcs.map((a) => a._id);
    const stateIds = [...new Set(adcs.map((a) => String(a.state)))].map((id) => new Types.ObjectId(id));
    const countByAdc = [{ $group: { _id: '$adc', count: { $sum: 1 } } }];
    const [ulbCounts, memberCounts, admins, states] = await Promise.all([
      this.ulbModel
        .aggregate<{ _id: Types.ObjectId; count: number }>([{ $match: { adc: { $in: ids } } }, ...countByAdc])
        .exec(),
      this.userModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([{ $match: { ...ACTIVE_ADC_MEMBER, adc: { $in: ids } } }, ...countByAdc])
        .exec(),
      this.userModel
        .find({ ...ACTIVE_ADC_MEMBER, adc: { $in: ids }, xviFcSubrole: 'admin' })
        .select('name email adc isXVIFCProfileVerified')
        .lean<
          { _id: Types.ObjectId; name: string; email: string; adc: Types.ObjectId; isXVIFCProfileVerified?: boolean }[]
        >()
        .exec(),
      this.stateModel
        .find({ _id: { $in: stateIds } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name: string }[]>()
        .exec(),
    ]);

    const ulbCountById = new Map(ulbCounts.map((c) => [String(c._id), c.count]));
    const memberCountById = new Map(memberCounts.map((c) => [String(c._id), c.count]));
    const adminById = new Map(admins.map((a) => [String(a.adc), a]));
    const stateNameById = new Map(states.map((s) => [String(s._id), s.name]));

    const data = adcs.map((adc): AdcManageRow => {
      const admin = adminById.get(String(adc._id));
      return {
        _id: adc._id,
        name: adc.name,
        state: { _id: adc.state, name: stateNameById.get(String(adc.state)) ?? null },
        ulbCount: ulbCountById.get(String(adc._id)) ?? 0,
        memberCount: memberCountById.get(String(adc._id)) ?? 0,
        admin: admin
          ? {
              _id: admin._id,
              name: admin.name,
              email: admin.email,
              isXVIFCProfileVerified: !!admin.isXVIFCProfileVerified,
            }
          : null,
      };
    });
    return { data, total, page, limit, totalPages };
  }

  members(id: string): Promise<AdcMemberForAdmin[]> {
    return this.usersService.listAdcMembersForAdmin(id);
  }

  /** Creates the ADC and invites its Admin. If the invite fails the new ADC is deleted again, so neither is left alone. */
  async create(dto: CreateAdcDto, user: AuthUser): Promise<AdcLean & { admin: StateMemberResponseDto }> {
    const stateId = new Types.ObjectId(dto.stateId);
    if (!(await this.stateModel.exists({ _id: stateId }))) throw new NotFoundException('State not found');
    await this.assertNameFree(stateId, dto.name);

    let adc: AdcDocument;
    try {
      adc = await this.adcModel.create({ name: dto.name, state: stateId, isActive: true });
    } catch (err) {
      if (isDuplicateKey(err)) throw adcNameExists();
      throw err;
    }
    const ref = { _id: adc._id, name: adc.name, state: adc.state };

    let admin: StateMemberResponseDto;
    try {
      admin = await this.usersService.createAdcAdmin(ref, { ...dto.admin, action: dto.action }, user);
    } catch (err) {
      await this.adcModel.deleteOne({ _id: ref._id }).exec();
      throw err;
    }

    await this.adcAuditLog.record({
      ...this.logBase(ref, user),
      action: AdcAuditAction.ADC_CREATED,
      user: admin._id,
    });
    return { ...ref, isActive: true, admin };
  }

  /** Name only: an ADC's state is fixed once created. The same name is a no-op (nothing written or logged). */
  async rename(id: string, dto: RenameAdcDto, user: AuthUser): Promise<AdcLean> {
    const adc = await this.findAdcOrThrow(id);
    if (adc.name === dto.name) return adc;
    await this.assertNameFree(adc.state, dto.name, adc._id);

    let updated: AdcLean | null;
    try {
      updated = await this.adcModel
        .findByIdAndUpdate(adc._id, { $set: { name: dto.name } }, { new: true })
        .select('name state isActive')
        .lean<AdcLean>()
        .exec();
    } catch (err) {
      if (isDuplicateKey(err)) throw adcNameExists();
      throw err;
    }
    if (!updated) throw new NotFoundException('ADC not found');

    await this.adcAuditLog.record({
      ...this.logBase(updated, user),
      action: AdcAuditAction.ADC_RENAMED,
      changes: { name: { from: adc.name, to: updated.name } },
    });
    return updated;
  }

  async setAdmin(id: string, dto: SetAdcAdminDto, user: AuthUser): Promise<{ message: string }> {
    const change = await this.usersService.setAdcAdmin(id, dto, user);
    await this.adcAuditLog.record({
      ...this.logBase(change.adc, user),
      action: AdcAuditAction.ADC_ADMIN_CHANGED,
      user: change.to,
      mode: change.mode,
      changes: { admin: { from: change.from, to: change.to } },
    });
    return { message: 'ADC Admin changed successfully' };
  }

  /**
   * Hard delete, only for an ADC with no ULB (any status) and no member besides its Admin. The Admin's account is
   * removed with it, and the ADC's removed members are detached so their emails can be invited elsewhere.
   */
  async remove(id: string, user: AuthUser): Promise<{ message: string }> {
    const adc = await this.findAdcOrThrow(id);
    const [ulbCount, otherMembers] = await Promise.all([
      this.ulbModel.countDocuments({ adc: adc._id }).exec(),
      this.userModel.countDocuments({ ...ACTIVE_ADC_MEMBER, adc: adc._id, xviFcSubrole: { $ne: 'admin' } }).exec(),
    ]);
    if (ulbCount || otherMembers) {
      const steps = [
        ulbCount ? `move its ${ulbCount} ULB${ulbCount === 1 ? '' : 's'}` : null,
        otherMembers ? `remove its ${otherMembers} other member${otherMembers === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      const message = `${steps.join(' and ')} first.`;
      throw new HttpException(
        { code: 'ADC_IN_USE', message: message.charAt(0).toUpperCase() + message.slice(1) },
        HttpStatus.CONFLICT,
      );
    }

    const removedAdminId = await this.usersService.removeAdcAdminAndDetachRemoved(adc._id);
    await this.adcModel.deleteOne({ _id: adc._id }).exec();

    await this.adcAuditLog.record({
      ...this.logBase(adc, user),
      action: AdcAuditAction.ADC_DELETED,
      user: removedAdminId,
    });
    return { message: 'ADC deleted successfully' };
  }

  private async findAdcOrThrow(id: string): Promise<AdcLean> {
    const adc = await this.adcModel.findById(id).select('name state isActive').lean<AdcLean>().exec();
    if (!adc) throw new NotFoundException('ADC not found');
    return adc;
  }

  /** Case-insensitive, so "bodoland" can't sit beside "Bodoland". The unique index catches exact-duplicate races. */
  private async assertNameFree(state: Types.ObjectId, name: string, exceptId?: Types.ObjectId): Promise<void> {
    const clash = await this.adcModel.exists({
      state,
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
    if (clash) throw adcNameExists();
  }

  private logBase(adc: { _id: Types.ObjectId; name: string; state: Types.ObjectId }, user: AuthUser) {
    return {
      adc: adc._id,
      adcName: adc.name,
      state: adc.state,
      performedBy: user._id,
      actorRole: 'PORTAL_ADMIN' as const,
    };
  }
}

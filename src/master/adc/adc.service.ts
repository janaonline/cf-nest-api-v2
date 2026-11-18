import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import type { PaginatedResult } from 'src/common/dto/pagination.dto';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { escapeRegex } from 'src/common/utils/regex.util';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import type { StateMemberResponseDto } from 'src/module/users/dto/state-member-response.dto';
import { AdcMemberForAdmin, UsersService } from 'src/module/users/users.service';
import { UlbService } from 'src/master/ulb/ulb.service';
import { Adc, AdcDocument } from 'src/schemas/adc.schema';
import { AdcAuditAction } from 'src/schemas/adc-audit-log.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { AdcAuditLogService } from './audit/adc-audit-log.service';
import type { AdcAdminStatus, AdcListQueryDto } from './dto/adc-list-query.dto';
import type { AdcMembersQueryDto } from './dto/adc-members-query.dto';
import type { AdcUlbsQueryDto } from './dto/adc-ulbs-query.dto';
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
  adminStatus: AdcAdminStatus;
}

export interface AdcDetail extends AdcManageRow {
  createdAt: Date | null;
}

export interface AdcUlbRow {
  _id: Types.ObjectId;
  name: string;
  code: string;
  ulbTypeName: string;
  district: string;
  isActive: boolean;
  /** EXISTING: a legacy ULB with no approval record. */
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXISTING';
}

const LIST_SORT_FIELD: Record<NonNullable<AdcListQueryDto['sortBy']>, string> = {
  name: 'name',
  state: 'stateName',
  ulbCount: 'ulbCount',
  memberCount: 'memberCount',
};

type AdcLean = { _id: Types.ObjectId; name: string; state: Types.ObjectId; isActive?: boolean };

/** Same as UsersService's active ADC member filter, without the `adc` (the callers add it). */
const ACTIVE_ADC_MEMBER = { role: Role.STATE, isDeleted: false, isXviFcdeleted: { $ne: true } };

const adcNameExists = () =>
  new HttpException(
    { code: 'ADC_NAME_EXISTS', message: 'An ADC with this name already exists in this state.' },
    HttpStatus.CONFLICT,
  );

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

/** Shapes rowStages()'s output into AdcManageRow. */
const ROW_PROJECTION = {
  _id: 1,
  name: 1,
  state: { _id: '$state', name: '$stateName' },
  ulbCount: 1,
  memberCount: 1,
  admin: {
    $cond: [
      { $not: ['$admin'] },
      null,
      {
        _id: '$admin._id',
        name: '$admin.name',
        email: '$admin.email',
        isXVIFCProfileVerified: { $eq: ['$admin.isXVIFCProfileVerified', true] },
      },
    ],
  },
  adminStatus: 1,
};

@Injectable()
export class AdcService {
  constructor(
    @InjectModel(Adc.name) private readonly adcModel: Model<AdcDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    private readonly usersService: UsersService,
    private readonly ulbService: UlbService,
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

  /**
   * One page of ADCs with their counts and Admin, in one aggregation so search (ADC or Admin), the Admin-status
   * filter and every sort see all ADCs before paging. ADCs number in the tens, so sorting before paging is cheap.
   */
  async listForAdmin(query: AdcListQueryDto): Promise<PaginatedResult<AdcManageRow>> {
    const { page, limit } = query;
    const match: FilterQuery<AdcDocument> = {};
    if (query.stateId) match.state = new Types.ObjectId(query.stateId);

    const pipeline: PipelineStage[] = [{ $match: match }, ...this.rowStages()];
    if (query.search) {
      const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
      pipeline.push({ $match: { $or: [{ name: pattern }, { 'admin.name': pattern }, { 'admin.email': pattern }] } });
    }
    if (query.adminStatus) pipeline.push({ $match: { adminStatus: query.adminStatus } });

    const sortField = LIST_SORT_FIELD[query.sortBy ?? 'name'];
    const dir = query.sortDir ?? 1;
    pipeline.push(
      { $sort: sortField === 'name' ? { name: dir, _id: 1 } : { [sortField]: dir, name: 1, _id: 1 } },
      {
        $facet: {
          data: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: ROW_PROJECTION }],
          total: [{ $count: 'count' }],
        },
      },
    );

    const [result] = await this.adcModel
      .aggregate<{ data: AdcManageRow[]; total: { count: number }[] }>(pipeline)
      .exec();
    const total = result?.total[0]?.count ?? 0;
    return { data: result?.data ?? [], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** The ADC detail page's header: the list row plus when the ADC was created. */
  async detail(id: string): Promise<AdcDetail> {
    const [adc] = await this.adcModel
      .aggregate<AdcDetail>([
        { $match: { _id: new Types.ObjectId(id) } },
        ...this.rowStages(),
        { $project: { ...ROW_PROJECTION, createdAt: { $ifNull: ['$createdAt', null] } } },
      ])
      .exec();
    if (!adc) throw new NotFoundException('ADC not found');
    return adc;
  }

  members(id: string, query: AdcMembersQueryDto): Promise<PaginatedResult<AdcMemberForAdmin>> {
    return this.usersService.listAdcMembersForAdmin(id, query);
  }

  /** One page of the ADC's ULBs, through the ULB list so its filters and approval rules stay in one place. */
  async ulbs(id: string, query: AdcUlbsQueryDto, user: IAuthUser): Promise<PaginatedResult<AdcUlbRow>> {
    const adc = await this.findAdcOrThrow(id);
    const result = await this.ulbService.findAll(
      { ...query, sortBy: query.sortBy ?? 'name', sortDir: query.sortDir ?? 1 },
      user,
      {
        adc: adc._id,
      },
    );
    const data = result.data.map(
      (ulb): AdcUlbRow => ({
        _id: (ulb as unknown as { _id: Types.ObjectId })._id,
        name: ulb.name,
        code: ulb.code,
        ulbTypeName: ulb.ulbTypeName,
        district: ulb.district ?? '',
        isActive: ulb.isActive,
        approvalStatus: ulb.isExistingUser ? 'EXISTING' : (ulb.approval?.status ?? 'APPROVED'),
      }),
    );
    return { data, total: result.total, page: result.page, limit: result.limit, totalPages: result.pages };
  }

  /**
   * Adds ulbCount, memberCount, admin, adminStatus and stateName to each ADC. The members lookup filters first
   * and joins on `adc` last: users has no plain `adc` index, and MongoDB runs an uncorrelated prefix once and
   * caches it, so users is scanned once rather than once per ADC.
   */
  private rowStages(): PipelineStage[] {
    return [
      {
        $lookup: {
          from: this.ulbModel.collection.name,
          let: { adcId: '$_id', stateId: '$state' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$state', '$$stateId'] }, { $eq: ['$adc', '$$adcId'] }] } } },
            { $count: 'count' },
          ],
          as: 'ulbAgg',
        },
      },
      {
        $lookup: {
          from: this.userModel.collection.name,
          let: { adcId: '$_id' },
          pipeline: [
            { $match: { ...ACTIVE_ADC_MEMBER, adc: { $type: 'objectId' } } },
            { $project: { adc: 1, name: 1, email: 1, xviFcSubrole: 1, isXVIFCProfileVerified: 1 } },
            { $match: { $expr: { $eq: ['$adc', '$$adcId'] } } },
          ],
          as: 'members',
        },
      },
      {
        $lookup: {
          from: this.stateModel.collection.name,
          localField: 'state',
          foreignField: '_id',
          as: 'stateDoc',
        },
      },
      {
        $addFields: {
          ulbCount: { $ifNull: [{ $arrayElemAt: ['$ulbAgg.count', 0] }, 0] },
          memberCount: { $size: '$members' },
          admin: {
            $arrayElemAt: [{ $filter: { input: '$members', cond: { $eq: ['$$this.xviFcSubrole', 'admin'] } } }, 0],
          },
          stateName: { $ifNull: [{ $arrayElemAt: ['$stateDoc.name', 0] }, null] },
        },
      },
      {
        $addFields: {
          adminStatus: {
            $cond: [
              { $not: ['$admin'] },
              'NOT_SET',
              { $cond: [{ $eq: ['$admin.isXVIFCProfileVerified', true] }, 'ACTIVE', 'INVITED'] },
            ],
          },
        },
      },
    ];
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

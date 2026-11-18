import { HttpException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { UlbService } from 'src/master/ulb/ulb.service';
import { UsersService } from 'src/module/users/users.service';
import { Adc } from 'src/schemas/adc.schema';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { User } from 'src/schemas/user/user.schema';
import { AdcService } from './adc.service';
import { AdcAuditLogService } from './audit/adc-audit-log.service';

/** Chainable Mongoose Query-like mock resolving to `value`. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

/** The pipeline stages the tests read back from the aggregate() mock. */
interface Stage {
  $match?: Record<string, unknown>;
  $lookup?: { from: string; localField?: string; foreignField?: string; pipeline?: { $match?: unknown }[] };
  $addFields?: Record<string, unknown>;
  $sort?: Record<string, number>;
  $facet?: { data: unknown[]; total: unknown[] };
  $project?: Record<string, unknown>;
}

const responseOf = (err: unknown) => (err as HttpException).getResponse();

describe('AdcService (Portal Admin)', () => {
  let service: AdcService;
  let adcModel: Record<string, jest.Mock>;
  let ulbModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let stateModel: Record<string, jest.Mock>;
  let usersService: Record<string, jest.Mock>;
  let ulbService: { findAll: jest.Mock };
  let auditLog: { record: jest.Mock };

  const admin = { _id: new Types.ObjectId().toString(), role: 'ADMIN' } as AuthUser;
  const stateId = new Types.ObjectId();
  const adcId = new Types.ObjectId();
  const adcDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: adcId,
    name: 'Bodoland Territorial Council',
    state: stateId,
    isActive: true,
    ...overrides,
  });

  beforeEach(async () => {
    adcModel = {
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findById: jest.fn().mockReturnValue(q(adcDoc())),
      findByIdAndUpdate: jest.fn(),
      deleteOne: jest.fn().mockReturnValue(q({ deletedCount: 1 })),
      aggregate: jest.fn().mockReturnValue(q([])),
    };
    ulbModel = { countDocuments: jest.fn().mockReturnValue(q(0)), collection: { name: 'ulbs' } as never };
    userModel = { countDocuments: jest.fn().mockReturnValue(q(0)), collection: { name: 'users' } as never };
    stateModel = { exists: jest.fn().mockResolvedValue({ _id: stateId }), collection: { name: 'states' } as never };
    ulbService = { findAll: jest.fn() };
    usersService = {
      createAdcAdmin: jest.fn(),
      setAdcAdmin: jest.fn(),
      listAdcMembersForAdmin: jest.fn(),
      removeAdcAdminAndDetachRemoved: jest.fn(),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdcService,
        { provide: getModelToken(Adc.name), useValue: adcModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: UsersService, useValue: usersService },
        { provide: UlbService, useValue: ulbService },
        { provide: AdcAuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get(AdcService);
  });

  // ─── list ──────────────────────────────────────────────────────────────

  describe('listForAdmin()', () => {
    const pipelineOf = (): Stage[] => (adcModel.aggregate.mock.calls[0] as [Stage[]])[0];
    const stageOf = (key: keyof Stage) => pipelineOf().filter((st) => key in st);

    it('returns the page from one aggregation, with the paging maths', async () => {
      const row = { _id: adcId, name: 'BTC', state: { _id: stateId, name: 'Assam' }, ulbCount: 3, memberCount: 2 };
      adcModel.aggregate.mockReturnValue(q([{ data: [row], total: [{ count: 5 }] }]));

      const result = await service.listForAdmin({ page: 2, limit: 2 });

      expect(adcModel.aggregate).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: [row], total: 5, page: 2, limit: 2, totalPages: 3 });
      const facet = stageOf('$facet')[0].$facet!;
      expect(facet.data.slice(0, 2)).toEqual([{ $skip: 2 }, { $limit: 2 }]);
      expect(facet.total).toEqual([{ $count: 'count' }]);
    });

    it('returns an empty page when nothing matches', async () => {
      adcModel.aggregate.mockReturnValue(q([{ data: [], total: [] }]));
      await expect(service.listForAdmin({ page: 1, limit: 20 })).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('filters by state first, and joins ULBs on state and adc so the {state, adc} index is used', async () => {
      await service.listForAdmin({ page: 1, limit: 20, stateId: String(stateId) });

      expect(pipelineOf()[0]).toEqual({ $match: { state: stateId } });
      const [ulbs, users, states] = stageOf('$lookup').map((st) => st.$lookup!);
      expect(ulbs.from).toBe('ulbs');
      expect(ulbs.pipeline![0].$match).toEqual({
        $expr: { $and: [{ $eq: ['$state', '$$stateId'] }, { $eq: ['$adc', '$$adcId'] }] },
      });
      // Active members only; the uncorrelated filter comes before the per-ADC join.
      expect(users.from).toBe('users');
      expect(users.pipeline![0].$match).toEqual(
        expect.objectContaining({ role: 'STATE', isDeleted: false, adc: { $type: 'objectId' } }),
      );
      expect(users.pipeline!.at(-1)).toEqual({ $match: { $expr: { $eq: ['$adc', '$$adcId'] } } });
      expect(states).toEqual(expect.objectContaining({ from: 'states', localField: 'state', foreignField: '_id' }));
    });

    it('searches the ADC name and the Admin name and email, escaping regex characters', async () => {
      await service.listForAdmin({ page: 1, limit: 20, search: 'a.*(b+)+' });

      const pattern = { $regex: 'a\\.\\*\\(b\\+\\)\\+', $options: 'i' };
      expect(pipelineOf()).toContainEqual({
        $match: { $or: [{ name: pattern }, { 'admin.name': pattern }, { 'admin.email': pattern }] },
      });
    });

    it('filters by Admin status after the Admin is derived', async () => {
      await service.listForAdmin({ page: 1, limit: 20, adminStatus: 'INVITED' });

      const stages = pipelineOf();
      const filterAt = stages.findIndex((st) => st.$match?.adminStatus === 'INVITED');
      const derivedAt = stages.findIndex((st) => st.$addFields?.adminStatus);
      expect(derivedAt).toBeGreaterThan(-1);
      expect(filterAt).toBeGreaterThan(derivedAt);
    });

    it('sorts by name by default, and by a count or the state name with the name as tiebreaker', async () => {
      await service.listForAdmin({ page: 1, limit: 20 });
      expect(stageOf('$sort')[0]).toEqual({ $sort: { name: 1, _id: 1 } });

      adcModel.aggregate.mockClear();
      await service.listForAdmin({ page: 1, limit: 20, sortBy: 'ulbCount', sortDir: -1 });
      expect(stageOf('$sort')[0]).toEqual({ $sort: { ulbCount: -1, name: 1, _id: 1 } });

      adcModel.aggregate.mockClear();
      await service.listForAdmin({ page: 1, limit: 20, sortBy: 'state' });
      expect(stageOf('$sort')[0]).toEqual({ $sort: { stateName: 1, name: 1, _id: 1 } });
    });

    it('sorts before paging', async () => {
      await service.listForAdmin({ page: 1, limit: 20 });
      const stages = pipelineOf();
      expect(stages.findIndex((st) => '$sort' in st)).toBeLessThan(stages.findIndex((st) => '$facet' in st));
    });
  });

  // ─── detail ────────────────────────────────────────────────────────────

  describe('detail()', () => {
    it('returns the ADC with its counts, Admin and created date', async () => {
      const row = { _id: adcId, name: 'BTC', createdAt: new Date('2026-10-30') };
      adcModel.aggregate.mockReturnValue(q([row]));

      await expect(service.detail(String(adcId))).resolves.toBe(row);
      const stages = (adcModel.aggregate.mock.calls[0] as [Stage[]])[0];
      expect(stages[0]).toEqual({ $match: { _id: adcId } });
      expect(stages.at(-1)!.$project).toEqual(
        expect.objectContaining({ createdAt: { $ifNull: ['$createdAt', null] } }),
      );
    });

    it('404s for an unknown ADC', async () => {
      await expect(service.detail(String(adcId))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── members and ULBs ──────────────────────────────────────────────────

  it('members() passes the query to the paged member list', async () => {
    const pageResult = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    usersService.listAdcMembersForAdmin.mockResolvedValue(pageResult);
    const query = { page: 1, limit: 20, level: 'EDITOR' as const };

    await expect(service.members(String(adcId), query)).resolves.toBe(pageResult);
    expect(usersService.listAdcMembersForAdmin).toHaveBeenCalledWith(String(adcId), query);
  });

  describe('ulbs()', () => {
    it("lists the ADC's ULBs through the ULB list and maps them to slim rows with totalPages", async () => {
      const ulbId = new Types.ObjectId();
      ulbService.findAll.mockResolvedValue({
        data: [
          {
            _id: ulbId,
            name: 'Kokrajhar MB',
            code: 'AS012',
            ulbTypeName: 'Municipality',
            district: 'Kokrajhar',
            isActive: true,
            approval: { status: 'PENDING' },
            isExistingUser: false,
            gazetteNotificationFile: { path: 'x' },
          },
          { _id: ulbId, name: 'Old', code: 'AS001', ulbTypeName: 'MB', isActive: false, isExistingUser: true },
        ],
        page: 2,
        limit: 10,
        total: 12,
        pages: 2,
      });
      const query = { page: 2, limit: 10, approvalStatus: 'PENDING' as const, search: 'kok' };

      const result = await service.ulbs(String(adcId), query, admin as unknown as IAuthUser);

      expect(ulbService.findAll).toHaveBeenCalledWith({ ...query, sortBy: 'name', sortDir: 1 }, admin, {
        adc: adcId,
      });
      expect(result).toEqual({
        page: 2,
        limit: 10,
        total: 12,
        totalPages: 2,
        data: [
          {
            _id: ulbId,
            name: 'Kokrajhar MB',
            code: 'AS012',
            ulbTypeName: 'Municipality',
            district: 'Kokrajhar',
            isActive: true,
            approvalStatus: 'PENDING',
          },
          {
            _id: ulbId,
            name: 'Old',
            code: 'AS001',
            ulbTypeName: 'MB',
            district: '',
            isActive: false,
            approvalStatus: 'EXISTING',
          },
        ],
      });
    });

    it('404s for an unknown ADC without listing ULBs', async () => {
      adcModel.findById.mockReturnValue(q(null));
      await expect(
        service.ulbs(String(adcId), { page: 1, limit: 20 }, admin as unknown as IAuthUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ulbService.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create()', () => {
    const adminInput = { name: 'A. Das', email: 'a@x.gov.in', mobile: '9876543210', designation: 'Secretary' };
    const dto = { stateId: String(stateId), name: 'Bodoland Territorial Council', admin: adminInput };

    it('creates the ADC, invites its Admin and logs one ADC_CREATED entry', async () => {
      adcModel.create.mockResolvedValue(adcDoc());
      const member = { _id: new Types.ObjectId().toString(), subRole: 'SUBMITTER' };
      usersService.createAdcAdmin.mockResolvedValue(member);

      const result = await service.create(dto, admin);

      expect(adcModel.create).toHaveBeenCalledWith({ name: dto.name, state: stateId, isActive: true });
      expect(usersService.createAdcAdmin).toHaveBeenCalledWith(
        { _id: adcId, name: dto.name, state: stateId },
        { ...adminInput, action: undefined },
        admin,
      );
      expect(result.admin).toBe(member);
      expect(auditLog.record).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith({
        action: 'ADC_CREATED',
        adc: adcId,
        adcName: dto.name,
        state: stateId,
        performedBy: admin._id,
        actorRole: 'PORTAL_ADMIN',
        user: member._id,
      });
    });

    it('refuses a name already used in the state, ignoring case and escaping regex characters', async () => {
      adcModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

      const error = await service.create({ ...dto, name: 'a.*(b+)+' }, admin).catch((e: unknown) => e);

      expect(responseOf(error)).toEqual(expect.objectContaining({ code: 'ADC_NAME_EXISTS' }));
      expect((error as HttpException).getStatus()).toBe(409);
      expect(adcModel.exists).toHaveBeenCalledWith({
        state: stateId,
        name: { $regex: '^a\\.\\*\\(b\\+\\)\\+$', $options: 'i' },
      });
      expect(adcModel.create).not.toHaveBeenCalled();
    });

    it("passes the top-level `action: 'restore'` on to the Admin invite", async () => {
      adcModel.create.mockResolvedValue(adcDoc());
      usersService.createAdcAdmin.mockResolvedValue({ _id: new Types.ObjectId().toString() });

      await service.create({ ...dto, action: 'restore' }, admin);

      expect(usersService.createAdcAdmin).toHaveBeenCalledWith(
        expect.anything(),
        { ...adminInput, action: 'restore' },
        admin,
      );
    });

    it('turns an exact-duplicate race (unique index) into the same 409', async () => {
      adcModel.create.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
      await expect(service.create(dto, admin)).rejects.toMatchObject({ response: { code: 'ADC_NAME_EXISTS' } });
    });

    it('deletes the new ADC again when the Admin invite fails, and logs nothing', async () => {
      adcModel.create.mockResolvedValue(adcDoc());
      const conflict = new HttpException({ code: 'EMAIL_ALREADY_ACTIVE', message: 'x' }, 409);
      usersService.createAdcAdmin.mockRejectedValue(conflict);

      await expect(service.create(dto, admin)).rejects.toBe(conflict);
      expect(adcModel.deleteOne).toHaveBeenCalledWith({ _id: adcId });
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('404s for an unknown state', async () => {
      stateModel.exists.mockResolvedValue(null);
      await expect(service.create(dto, admin)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── rename ────────────────────────────────────────────────────────────

  describe('rename()', () => {
    it('is a no-op for the same name: no write, no log', async () => {
      await service.rename(String(adcId), { name: 'Bodoland Territorial Council' }, admin);
      expect(adcModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('refuses a name another ADC of the state uses, in any case', async () => {
      adcModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

      await expect(service.rename(String(adcId), { name: 'DIMA HASAO' }, admin)).rejects.toMatchObject({
        response: { code: 'ADC_NAME_EXISTS' },
      });
      expect(adcModel.exists).toHaveBeenCalledWith({
        state: stateId,
        name: { $regex: '^DIMA HASAO$', $options: 'i' },
        _id: { $ne: adcId },
      });
      expect(adcModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('renames and logs the from/to names', async () => {
      adcModel.findByIdAndUpdate.mockReturnValue(q(adcDoc({ name: 'BTC' })));

      await service.rename(String(adcId), { name: 'BTC' }, admin);

      expect(adcModel.findByIdAndUpdate).toHaveBeenCalledWith(adcId, { $set: { name: 'BTC' } }, { new: true });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADC_RENAMED',
          adcName: 'BTC',
          changes: { name: { from: 'Bodoland Territorial Council', to: 'BTC' } },
        }),
      );
    });

    it('404s for an unknown ADC', async () => {
      adcModel.findById.mockReturnValue(q(null));
      await expect(service.rename(String(adcId), { name: 'BTC' }, admin)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── change Admin ──────────────────────────────────────────────────────

  it('setAdmin() logs the Admin change with its mode', async () => {
    const from = new Types.ObjectId();
    const to = new Types.ObjectId();
    usersService.setAdcAdmin.mockResolvedValue({ adc: adcDoc(), from, to, mode: 'PROMOTED' });

    await service.setAdmin(String(adcId), { mode: 'promote', userId: String(to) }, admin);

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADC_ADMIN_CHANGED',
        user: to,
        mode: 'PROMOTED',
        changes: { admin: { from, to } },
      }),
    );
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('refuses an ADC that still has ULBs or other members, naming both', async () => {
      ulbModel.countDocuments.mockReturnValue(q(12));
      userModel.countDocuments.mockReturnValue(q(3));

      const error = await service.remove(String(adcId), admin).catch((e: unknown) => e);

      expect(responseOf(error)).toEqual({
        code: 'ADC_IN_USE',
        message: 'Move its 12 ULBs and remove its 3 other members first.',
      });
      expect(userModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ adc: adcId, xviFcSubrole: { $ne: 'admin' } }),
      );
      expect(usersService.removeAdcAdminAndDetachRemoved).not.toHaveBeenCalled();
      expect(adcModel.deleteOne).not.toHaveBeenCalled();
    });

    it('names only what blocks it', async () => {
      ulbModel.countDocuments.mockReturnValue(q(1));
      await expect(service.remove(String(adcId), admin)).rejects.toMatchObject({
        response: { code: 'ADC_IN_USE', message: 'Move its 1 ULB first.' },
      });
    });

    it('removes the Admin, deletes the ADC and logs ADC_DELETED with the removed Admin', async () => {
      const adminId = new Types.ObjectId();
      usersService.removeAdcAdminAndDetachRemoved.mockResolvedValue(adminId);

      await expect(service.remove(String(adcId), admin)).resolves.toEqual({ message: 'ADC deleted successfully' });

      expect(usersService.removeAdcAdminAndDetachRemoved).toHaveBeenCalledWith(adcId);
      expect(adcModel.deleteOne).toHaveBeenCalledWith({ _id: adcId });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADC_DELETED', adc: adcId, user: adminId }),
      );
    });
  });
});

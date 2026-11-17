import { HttpException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
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

const responseOf = (err: unknown) => (err as HttpException).getResponse();

describe('AdcService (Portal Admin)', () => {
  let service: AdcService;
  let adcModel: Record<string, jest.Mock>;
  let ulbModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let stateModel: Record<string, jest.Mock>;
  let usersService: Record<string, jest.Mock>;
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
    };
    ulbModel = { aggregate: jest.fn().mockReturnValue(q([])), countDocuments: jest.fn().mockReturnValue(q(0)) };
    userModel = {
      aggregate: jest.fn().mockReturnValue(q([])),
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(q(0)),
    };
    stateModel = { find: jest.fn().mockReturnValue(q([])), exists: jest.fn().mockResolvedValue({ _id: stateId }) };
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
        { provide: AdcAuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get(AdcService);
  });

  // ─── list ──────────────────────────────────────────────────────────────

  describe('listForAdmin()', () => {
    it('pages, then maps counts, the Admin and the state name from batched queries', async () => {
      const other = new Types.ObjectId();
      const adminId = new Types.ObjectId();
      const page = q([adcDoc(), { _id: other, name: 'Dima Hasao', state: stateId }]);
      adcModel.find.mockReturnValue(page);
      adcModel.countDocuments.mockReturnValue(q(5));
      ulbModel.aggregate.mockReturnValue(q([{ _id: adcId, count: 12 }]));
      userModel.aggregate.mockReturnValue(
        q([
          { _id: adcId, count: 4 },
          { _id: other, count: 1 },
        ]),
      );
      userModel.find.mockReturnValue(
        q([{ _id: adminId, name: 'A. Das', email: 'a@x.gov.in', adc: adcId, isXVIFCProfileVerified: true }]),
      );
      stateModel.find.mockReturnValue(q([{ _id: stateId, name: 'Assam' }]));

      const result = await service.listForAdmin({ page: 2, limit: 2 });

      expect(page.skip).toHaveBeenCalledWith(2);
      expect(page.limit).toHaveBeenCalledWith(2);
      expect(page.sort).toHaveBeenCalledWith({ name: 1 });
      expect(result).toEqual({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
        data: [
          {
            _id: adcId,
            name: 'Bodoland Territorial Council',
            state: { _id: stateId, name: 'Assam' },
            ulbCount: 12,
            memberCount: 4,
            admin: { _id: adminId, name: 'A. Das', email: 'a@x.gov.in', isXVIFCProfileVerified: true },
          },
          {
            _id: other,
            name: 'Dima Hasao',
            state: { _id: stateId, name: 'Assam' },
            ulbCount: 0,
            memberCount: 1,
            admin: null,
          },
        ],
      });
      // The counts and Admins are batched over the page's ids, never queried per row.
      expect(ulbModel.aggregate).toHaveBeenCalledTimes(1);
      expect(userModel.find).toHaveBeenCalledWith(expect.objectContaining({ adc: { $in: [adcId, other] } }));
    });

    it('filters by state and matches the search literally, escaping regex characters', async () => {
      await service.listForAdmin({ page: 1, limit: 20, stateId: String(stateId), search: 'a.*(b+)+' });

      expect(adcModel.find).toHaveBeenCalledWith({
        state: stateId,
        name: { $regex: 'a\\.\\*\\(b\\+\\)\\+', $options: 'i' },
      });
    });

    it('runs no batched queries for an empty page', async () => {
      await expect(service.listForAdmin({ page: 1, limit: 20 })).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
      expect(ulbModel.aggregate).not.toHaveBeenCalled();
      expect(userModel.find).not.toHaveBeenCalled();
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

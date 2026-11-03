import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';

import { UsersService } from './users.service';
import { User } from 'src/schemas/user/user.schema';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Adc } from 'src/schemas/adc.schema';
import { RedisService } from 'src/core/services/redis/redis.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { EmailDomainValidationService } from 'src/core/email-domain-validation/email-domain-validation.service';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';

import {
  createChainMock,
  makeStateAdmin,
  makeUserDoc,
  makeOverridesDto,
  STATE_ID,
  STATE_ID_2,
  TARGET_USER_ID,
} from './test/users.fixtures';

const ADC_ID = new Types.ObjectId().toString();
const ADC_ID_2 = new Types.ObjectId().toString();

const adcDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(ADC_ID),
  name: 'Test ADC',
  state: new Types.ObjectId(STATE_ID),
  isActive: true,
  ...overrides,
});

/** A STATE-role user scoped to an ADC (xviFcSubrole picks admin / reviewer / viewer). */
const makeAdcUser = (xviFcSubrole: 'admin' | 'reviewer' | 'viewer', overrides: Record<string, unknown> = {}) =>
  makeStateAdmin({ xviFcSubrole, adc: ADC_ID, ...overrides } as never);

describe('UsersService — ADC (Autonomous District Council) users', () => {
  let service: UsersService;
  let mockUserModel: ReturnType<typeof createChainMock>;
  let mockAdcModel: ReturnType<typeof createChainMock>;
  let mockStateModel: ReturnType<typeof createChainMock>;
  let mockEmailQueueService: { addEmailJob: jest.Mock };

  beforeEach(async () => {
    mockUserModel = createChainMock();
    mockAdcModel = createChainMock();
    mockStateModel = createChainMock();
    mockEmailQueueService = { addEmailJob: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(State.name), useValue: mockStateModel },
        { provide: getModelToken(Ulb.name), useValue: createChainMock() },
        { provide: getModelToken(Adc.name), useValue: mockAdcModel },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://cityfinance.in') } },
        {
          provide: EmailDomainValidationService,
          useValue: { domainHasMxRecord: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  const inviteDto = {
    name: 'New Member',
    email: 'member@example.com',
    mobile: '9876543210',
    designation: 'Officer',
    subRole: 'EDITOR' as const,
  };

  // ─── hardened State routes ──────────────────────────────────────────────

  describe('State team routes no longer reach ADC users, or accept the wrong caller', () => {
    const stateMember = (overrides: Record<string, unknown> = {}) =>
      makeUserDoc({ role: Role.STATE, xviFcSubrole: 'reviewer', state: new Types.ObjectId(STATE_ID), ...overrides });

    it('softDeleteStateUser: a State admin cannot remove an ADC user', async () => {
      mockUserModel.exec.mockResolvedValueOnce(stateMember({ adc: new Types.ObjectId(ADC_ID) }));
      await expect(service.softDeleteStateUser(TARGET_USER_ID, makeStateAdmin())).rejects.toThrow(ForbiddenException);
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('softDeleteStateUser: a State reviewer, an ADC admin and a member of another state are all refused', async () => {
      for (const requester of [
        makeStateAdmin({ xviFcSubrole: 'reviewer' }),
        makeAdcUser('admin'),
        makeStateAdmin({ state: new Types.ObjectId(STATE_ID_2) }),
      ]) {
        mockUserModel.exec.mockResolvedValueOnce(stateMember());
        await expect(service.softDeleteStateUser(TARGET_USER_ID, requester)).rejects.toThrow(ForbiddenException);
      }
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('softDeleteStateUser: platform ADMIN keeps its reach', async () => {
      mockUserModel.exec.mockResolvedValueOnce(stateMember()).mockResolvedValueOnce(undefined);
      const admin = makeStateAdmin({ scope: Scope.ADMIN, state: undefined });
      await expect(service.softDeleteStateUser(TARGET_USER_ID, admin)).resolves.toEqual({
        message: 'Member removed from the XVI-FC portal',
      });
    });

    it('updateXviFcSubrole: refuses an ADC target, a non-admin caller, and the State admin as target', async () => {
      mockUserModel.exec.mockResolvedValueOnce(stateMember({ adc: new Types.ObjectId(ADC_ID) }));
      await expect(service.updateXviFcSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeStateAdmin())).rejects.toThrow(
        ForbiddenException,
      );

      mockUserModel.exec.mockResolvedValueOnce(stateMember());
      await expect(
        service.updateXviFcSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeStateAdmin({ xviFcSubrole: 'reviewer' })),
      ).rejects.toThrow(ForbiddenException);

      mockUserModel.exec.mockResolvedValueOnce(stateMember({ xviFcSubrole: 'admin' }));
      await expect(service.updateXviFcSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeStateAdmin())).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('updateXviFcSubrole: a State admin can still re-level a plain State member of their state', async () => {
      mockUserModel.exec.mockResolvedValueOnce(stateMember());
      await service.updateXviFcSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeStateAdmin());
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, {
        $set: { xviFcSubrole: 'viewer' },
      });
    });

    it('inviteStateMember: only the State admin may invite — not a reviewer, not an ADC user', async () => {
      await expect(service.inviteStateMember(inviteDto, makeStateAdmin({ xviFcSubrole: 'reviewer' }))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.inviteStateMember(inviteDto, makeAdcUser('admin'))).rejects.toThrow(ForbiddenException);
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });

    it('transferSubmitter: an ADC user cannot transfer, and an ADC user cannot be the target', async () => {
      await expect(service.transferSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('admin'))).rejects.toThrow(
        ForbiddenException,
      );

      mockUserModel.exec.mockResolvedValueOnce(
        stateMember({ adc: new Types.ObjectId(ADC_ID), isXVIFCProfileVerified: true }),
      );
      await expect(service.transferSubmitter({ toUserId: TARGET_USER_ID }, makeStateAdmin())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updatePermissionOverrides: an ADC user cannot set overrides, and an ADC user cannot receive them', async () => {
      await expect(
        service.updatePermissionOverrides(TARGET_USER_ID, makeOverridesDto(), makeAdcUser('admin')),
      ).rejects.toThrow(ForbiddenException);

      mockUserModel.exec.mockResolvedValueOnce(stateMember({ adc: new Types.ObjectId(ADC_ID) }));
      await expect(
        service.updatePermissionOverrides(TARGET_USER_ID, makeOverridesDto(), makeStateAdmin()),
      ).rejects.toThrow(BadRequestException);
    });

    it('getStateMembers: leaves ADC users out of the State team list', async () => {
      mockUserModel.exec.mockResolvedValueOnce([]);
      await service.getStateMembers(STATE_ID);
      expect(mockUserModel.find).toHaveBeenCalledWith(expect.objectContaining({ adc: null }));
    });
  });

  // ─── ADC team ───────────────────────────────────────────────────────────

  describe('inviteAdcMember()', () => {
    beforeEach(() => {
      // activeUser lookup, removedUser lookup — both clean
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockUserModel.create.mockResolvedValue({ _id: new Types.ObjectId(TARGET_USER_ID) });
      mockStateModel.exec.mockResolvedValue({ name: 'Assam' });
    });

    it('makes the first user invited to an ADC with no admin its admin, whatever level was asked for', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue(null); // no admin yet

      await service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID);

      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: Role.STATE,
          xviFcSubrole: 'admin',
          adc: new Types.ObjectId(ADC_ID),
          state: new Types.ObjectId(STATE_ID),
        }),
      );
      expect(mockEmailQueueService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          mailData: expect.objectContaining({ adcName: 'Test ADC', role: 'Admin', invitedBy: 'ADC Administrator' }),
        }),
      );
    });

    it('stores later invites as reviewer / viewer', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });

      await service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID);
      expect(mockUserModel.create).toHaveBeenLastCalledWith(expect.objectContaining({ xviFcSubrole: 'reviewer' }));

      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      await service.inviteAdcMember({ ...inviteDto, subRole: 'VIEWER' }, makeStateAdmin(), ADC_ID);
      expect(mockUserModel.create).toHaveBeenLastCalledWith(expect.objectContaining({ xviFcSubrole: 'viewer' }));
    });

    it("lets the ADC's own admin invite into their ADC, ignoring any adcId sent", async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });

      await service.inviteAdcMember(inviteDto, makeAdcUser('admin'), ADC_ID_2);

      expect(mockAdcModel.findById).toHaveBeenCalledWith(ADC_ID);
      expect(mockUserModel.create).toHaveBeenCalledWith(expect.objectContaining({ adc: new Types.ObjectId(ADC_ID) }));
    });
  });

  describe('invite / restore never cross an ADC boundary, and the admin race is caught', () => {
    beforeEach(() => mockStateModel.exec.mockResolvedValue({ name: 'Assam' }));

    it('refuses inviting a removed member of another team into an ADC, without revealing who they were', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });
      mockUserModel.exec
        .mockResolvedValueOnce(null) // no active user with this email
        .mockResolvedValueOnce({ name: 'Old State Member', designation: 'DMA', adc: null }); // removed State member

      const error = await service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID).catch((e: HttpException) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({
        code: 'EMAIL_REMOVED_OTHER_TEAM',
        message: expect.not.stringContaining('Old State Member'),
      });
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });

    it('still offers the restore prompt for a member removed from this same ADC', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });
      mockUserModel.exec
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ name: 'Old ADC Member', designation: 'Officer', adc: new Types.ObjectId(ADC_ID) });

      await expect(service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID)).rejects.toMatchObject({
        response: { code: 'EMAIL_XVIFC_REMOVED' },
      });
    });

    it('refuses a State admin restoring a removed ADC user into the State team (no ADC → State move)', async () => {
      mockUserModel.exec
        .mockResolvedValueOnce(null) // no active user
        .mockResolvedValueOnce(makeUserDoc({ role: Role.STATE, adc: new Types.ObjectId(ADC_ID), isDeleted: true }));

      await expect(
        service.inviteStateMember({ ...inviteDto, action: 'restore' }, makeStateAdmin()),
      ).rejects.toMatchObject({
        response: { code: 'EMAIL_REMOVED_OTHER_TEAM' },
      });
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('turns a concurrent first-admin invite (unique-index hit) into ADC_ADMIN_EXISTS', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue(null); // both requests saw "no admin yet"
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockUserModel.create.mockRejectedValueOnce(
        Object.assign(new Error('E11000'), { code: 11000, keyPattern: { adc: 1, xviFcSubrole: 1 } }),
      );

      await expect(service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID)).rejects.toMatchObject({
        response: { code: 'ADC_ADMIN_EXISTS' },
      });
      expect(mockEmailQueueService.addEmailJob).not.toHaveBeenCalled();
    });

    it('leaves any other duplicate-key error (e.g. mobile) untouched', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const mobileDuplicate = Object.assign(new Error('E11000 mobile'), { code: 11000, keyPattern: { mobile: 1 } });
      mockUserModel.create.mockRejectedValueOnce(mobileDuplicate);

      await expect(service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID)).rejects.toBe(mobileDuplicate);
    });
  });

  describe('a deactivated ADC', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc({ isActive: false })));

    it('refuses invites and level changes', async () => {
      await expect(service.inviteAdcMember(inviteDto, makeStateAdmin(), ADC_ID)).rejects.toThrow(
        'This ADC is not active',
      );
      await expect(
        service.updateAdcMemberSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeStateAdmin(), ADC_ID),
      ).rejects.toThrow('This ADC is not active');
      expect(mockUserModel.create).not.toHaveBeenCalled();
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('still lists and removes members, so its team can be cleaned up', async () => {
      mockUserModel.exec.mockResolvedValueOnce([]);
      await expect(service.getAdcMembers(makeStateAdmin(), ADC_ID)).resolves.toEqual([]);

      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' }).mockResolvedValueOnce(undefined);
      await expect(service.removeAdcMember(TARGET_USER_ID, makeStateAdmin(), ADC_ID)).resolves.toEqual({
        message: 'Member removed from the XVI-FC portal',
      });
    });
  });

  describe('team access rules', () => {
    it('refuses a reviewer or viewer of the ADC (read yes, manage no)', async () => {
      mockAdcModel.exec.mockResolvedValue(adcDoc());
      await expect(service.inviteAdcMember(inviteDto, makeAdcUser('reviewer'))).rejects.toThrow(ForbiddenException);
      await expect(service.removeAdcMember(TARGET_USER_ID, makeAdcUser('viewer'))).rejects.toThrow(ForbiddenException);
    });

    it('lets an ADC reviewer read the team', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exec.mockResolvedValueOnce([]);
      await expect(service.getAdcMembers(makeAdcUser('reviewer'))).resolves.toEqual([]);
    });

    it("refuses a State admin acting on another state's ADC, and one who sends no adcId", async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc({ state: new Types.ObjectId(STATE_ID_2) }));
      await expect(service.getAdcMembers(makeStateAdmin(), ADC_ID)).rejects.toThrow(ForbiddenException);
      await expect(service.getAdcMembers(makeStateAdmin())).rejects.toThrow(BadRequestException);
    });

    it('refuses anyone who is not a State or ADC user', async () => {
      await expect(service.getAdcMembers(makeStateAdmin({ scope: Scope.ULB, role: Role.ULB }), ADC_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s for an unknown ADC', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(null);
      await expect(service.getAdcMembers(makeStateAdmin(), ADC_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeAdcMember()', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc()));

    it('soft-deletes a reviewer of the same ADC', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' }).mockResolvedValueOnce(undefined);
      await service.removeAdcMember(TARGET_USER_ID, makeStateAdmin(), ADC_ID);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, {
        $set: { isXviFcdeleted: true, isDeleted: true },
      });
    });

    it('cannot remove the ADC admin before a transfer, nor yourself', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'admin' });
      await expect(service.removeAdcMember(TARGET_USER_ID, makeStateAdmin(), ADC_ID)).rejects.toThrow(
        BadRequestException,
      );

      const self = makeAdcUser('admin', { _id: TARGET_USER_ID });
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' });
      await expect(service.removeAdcMember(TARGET_USER_ID, self)).rejects.toThrow(BadRequestException);
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('404s for a user who is not in that ADC', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null);
      await expect(service.removeAdcMember(TARGET_USER_ID, makeStateAdmin(), ADC_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('transferAdcSubmitter()', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc()));

    it('demotes the ADC admin to reviewer, then promotes the target (State admin acting for the ADC)', async () => {
      const currentAdminId = new Types.ObjectId();
      mockUserModel.exec
        .mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: true }) // target
        .mockResolvedValueOnce({ _id: currentAdminId }) // current admin
        .mockResolvedValue(undefined);

      await service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeStateAdmin(), ADC_ID);

      // Demote first: the unique index would refuse two admins at once.
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenNthCalledWith(1, currentAdminId, {
        $set: { xviFcSubrole: 'reviewer' },
      });
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
        $set: { xviFcSubrole: 'admin' },
      });
    });

    it('re-promotes the old admin if the promotion fails, so the ADC is never left without one', async () => {
      const currentAdminId = new Types.ObjectId();
      mockUserModel.exec
        .mockResolvedValueOnce({ xviFcSubrole: 'viewer', isXVIFCProfileVerified: true })
        .mockResolvedValueOnce({ _id: currentAdminId });
      mockUserModel.findByIdAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(undefined) })
        .mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(new Error('db down')) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(undefined) });

      await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('admin'))).rejects.toThrow(
        'db down',
      );
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenLastCalledWith(currentAdminId, {
        $set: { xviFcSubrole: 'admin' },
      });
    });

    it('turns a concurrent second admin (unique-index hit) into ADC_ADMIN_EXISTS and restores the old admin', async () => {
      const currentAdminId = new Types.ObjectId();
      mockUserModel.exec
        .mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: true })
        .mockResolvedValueOnce({ _id: currentAdminId });
      const duplicate = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { adc: 1, xviFcSubrole: 1 } });
      mockUserModel.findByIdAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(undefined) })
        .mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(duplicate) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(undefined) });

      await expect(
        service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeStateAdmin(), ADC_ID),
      ).rejects.toMatchObject({ response: { code: 'ADC_ADMIN_EXISTS' } });
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenLastCalledWith(currentAdminId, {
        $set: { xviFcSubrole: 'admin' },
      });
    });

    it('refuses a transfer for an inactive ADC', async () => {
      mockAdcModel.exec.mockResolvedValue({ ...adcDoc(), isActive: false });

      await expect(
        service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeStateAdmin(), ADC_ID),
      ).rejects.toThrow('This ADC is not active');
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses an unverified target, the current admin, and a non-admin caller', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: false });
      await expect(
        service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeStateAdmin(), ADC_ID),
      ).rejects.toThrow(BadRequestException);

      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'admin', isXVIFCProfileVerified: true });
      await expect(
        service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeStateAdmin(), ADC_ID),
      ).rejects.toThrow(BadRequestException);

      await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('reviewer'))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── platform Admin API ─────────────────────────────────────────────────

  describe('adminCreateUser() with adcId', () => {
    const platformAdmin = makeStateAdmin({ scope: Scope.ADMIN, state: undefined });
    const dto = {
      name: 'ADC User',
      email: 'adc.user@example.com',
      mobile: '8987654321',
      designation: 'ADC Officer',
      role: Role.STATE,
      subRole: 'EDITOR' as const,
      stateId: STATE_ID,
      adcId: ADC_ID,
    };

    beforeEach(() => {
      // duplicate-email lookup finds nothing; the state exists
      mockUserModel.exec.mockResolvedValueOnce(null);
      mockStateModel.exec.mockResolvedValueOnce({ _id: new Types.ObjectId(STATE_ID) });
      mockUserModel.create.mockResolvedValue({ _id: new Types.ObjectId(TARGET_USER_ID), ...dto });
    });

    it('stamps the ADC and makes the first user of an ADC without an admin its admin', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue(null);

      await service.adminCreateUser(dto as never, platformAdmin);

      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ adc: new Types.ObjectId(ADC_ID), xviFcSubrole: 'admin' }),
      );
    });

    it('refuses a second admin for an ADC with 409', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });

      await expect(service.adminCreateUser({ ...dto, subRole: 'ADMIN' } as never, platformAdmin)).rejects.toThrow(
        HttpException,
      );
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });

    it('requires a subRole for an ADC user', async () => {
      await expect(service.adminCreateUser({ ...dto, subRole: undefined } as never, platformAdmin)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });

    it('refuses an inactive ADC', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc({ isActive: false }));
      await expect(service.adminCreateUser(dto as never, platformAdmin)).rejects.toThrow(BadRequestException);
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });

    it('refuses an ADC that belongs to another state', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc({ state: new Types.ObjectId(STATE_ID_2) }));
      await expect(service.adminCreateUser(dto as never, platformAdmin)).rejects.toThrow(BadRequestException);
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });
  });

  describe('adminUpdateUser()', () => {
    const platformAdmin = makeStateAdmin({ scope: Scope.ADMIN, state: undefined });

    it('rejects an adcId that differs from the user’s current ADC', async () => {
      mockUserModel.exec.mockResolvedValueOnce(makeUserDoc({ role: Role.STATE, adc: new Types.ObjectId(ADC_ID) }));
      await expect(
        service.adminUpdateUser(TARGET_USER_ID, { adcId: ADC_ID_2 } as never, platformAdmin),
      ).rejects.toThrow("A user's ADC cannot be changed");

      // Setting an ADC on a normal user is a change too.
      mockUserModel.exec.mockResolvedValueOnce(makeUserDoc({ role: Role.STATE, adc: null }));
      await expect(service.adminUpdateUser(TARGET_USER_ID, { adcId: ADC_ID } as never, platformAdmin)).rejects.toThrow(
        "A user's ADC cannot be changed",
      );
    });

    it('ignores an adcId that just echoes the current value (null for a normal user)', async () => {
      const updated = makeUserDoc({ role: Role.STATE, name: 'Renamed' });
      mockUserModel.exec
        .mockResolvedValueOnce(makeUserDoc({ role: Role.STATE, adc: null })) // target
        .mockResolvedValueOnce(updated); // the update
      await expect(
        service.adminUpdateUser(TARGET_USER_ID, { adcId: null, name: 'Renamed' } as never, platformAdmin),
      ).resolves.toBeDefined();
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        TARGET_USER_ID,
        { $set: { name: 'Renamed' } },
        { new: true },
      );
    });

    it("rejects changing an ADC user's role or state, and a second admin for the ADC", async () => {
      const target = () =>
        makeUserDoc({
          role: Role.STATE,
          state: new Types.ObjectId(STATE_ID),
          adc: new Types.ObjectId(ADC_ID),
          xviFcSubrole: 'reviewer',
        });

      mockUserModel.exec.mockResolvedValueOnce(target());
      await expect(service.adminUpdateUser(TARGET_USER_ID, { role: Role.ULB } as never, platformAdmin)).rejects.toThrow(
        BadRequestException,
      );

      mockUserModel.exec.mockResolvedValueOnce(target());
      await expect(
        service.adminUpdateUser(TARGET_USER_ID, { stateId: STATE_ID_2 } as never, platformAdmin),
      ).rejects.toThrow(BadRequestException);

      mockUserModel.exec.mockResolvedValueOnce(target());
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-admin' });
      await expect(
        service.adminUpdateUser(TARGET_USER_ID, { subRole: 'ADMIN' } as never, platformAdmin),
      ).rejects.toThrow(HttpException);
    });
  });
});

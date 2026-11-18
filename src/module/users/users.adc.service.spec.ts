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
import { AdcAuditLogService } from 'src/master/adc/audit/adc-audit-log.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './dto/create-user.dto';

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
  let mockAdcAuditLog: { record: jest.Mock };

  beforeEach(async () => {
    mockUserModel = createChainMock();
    mockAdcModel = createChainMock();
    mockStateModel = createChainMock();
    mockEmailQueueService = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    mockAdcAuditLog = { record: jest.fn().mockResolvedValue(undefined) };

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
        { provide: AdcAuditLogService, useValue: mockAdcAuditLog },
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

  // ─── ADC team (managed by the ADC admin) ───────────────────────────────

  describe('the State DMA no longer reaches ADC teams', () => {
    it('refuses every State DMA user on every users/adc-* call, before looking up any ADC', async () => {
      for (const requester of [makeStateAdmin(), makeStateAdmin({ xviFcSubrole: 'reviewer' })]) {
        await expect(service.getAdcMembers(requester)).rejects.toThrow('ADC teams are managed by the ADC Admin.');
        await expect(service.inviteAdcMember(inviteDto, requester)).rejects.toThrow(ForbiddenException);
        await expect(service.updateAdcMemberSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, requester)).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service.removeAdcMember(TARGET_USER_ID, requester)).rejects.toThrow(ForbiddenException);
        await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, requester)).rejects.toThrow(
          ForbiddenException,
        );
      }
      expect(mockAdcModel.findById).not.toHaveBeenCalled();
      expect(mockAdcAuditLog.record).not.toHaveBeenCalled();
    });

    it('refuses anyone who is not a State or ADC user', async () => {
      await expect(service.getAdcMembers(makeStateAdmin({ scope: Scope.ULB, role: Role.ULB }))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.getAdcMembers(makeStateAdmin({ scope: Scope.ADMIN, state: undefined }))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('inviteAdcMember()', () => {
    beforeEach(() => {
      // activeUser lookup, removedUser lookup - both clean
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockUserModel.create.mockResolvedValue({ _id: new Types.ObjectId(TARGET_USER_ID) });
      mockStateModel.exec.mockResolvedValue({ name: 'Assam' });
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
    });

    it("invites into the caller's own ADC at the level asked for, never as Admin, and logs it", async () => {
      await service.inviteAdcMember(inviteDto, makeAdcUser('admin'));

      expect(mockAdcModel.findById).toHaveBeenCalledWith(ADC_ID);
      expect(mockUserModel.exists).not.toHaveBeenCalled(); // no "first invite becomes Admin" check any more
      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: Role.STATE, xviFcSubrole: 'reviewer', adc: new Types.ObjectId(ADC_ID) }),
      );
      expect(mockEmailQueueService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          mailData: expect.objectContaining({ adcName: 'Test ADC', role: 'Reviewer', portalInvite: false }),
        }),
      );
      expect(mockAdcAuditLog.record).toHaveBeenCalledWith({
        action: 'MEMBER_INVITED',
        adc: new Types.ObjectId(ADC_ID),
        adcName: 'Test ADC',
        state: new Types.ObjectId(STATE_ID),
        performedBy: expect.any(String),
        actorRole: 'ADC_ADMIN',
        user: TARGET_USER_ID,
      });
    });

    it('stores a VIEWER invite as viewer', async () => {
      await service.inviteAdcMember({ ...inviteDto, subRole: 'VIEWER' }, makeAdcUser('admin'));
      expect(mockUserModel.create).toHaveBeenCalledWith(expect.objectContaining({ xviFcSubrole: 'viewer' }));
    });
  });

  it('logs MEMBER_RESTORED when a removed member of the same ADC is restored', async () => {
    mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
    mockStateModel.exec.mockResolvedValue({ name: 'Assam' });
    mockUserModel.exists.mockResolvedValue(null); // no race conflict
    mockUserModel.exec
      .mockResolvedValueOnce(null) // no active user
      .mockResolvedValueOnce({ _id: new Types.ObjectId(TARGET_USER_ID), adc: new Types.ObjectId(ADC_ID) }) // removed
      .mockResolvedValueOnce({ _id: new Types.ObjectId(TARGET_USER_ID) }); // restored

    await service.inviteAdcMember({ ...inviteDto, action: 'restore' }, makeAdcUser('admin'));

    expect(mockAdcAuditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBER_RESTORED' }));
  });

  describe('invite / restore never cross an ADC boundary', () => {
    beforeEach(() => mockStateModel.exec.mockResolvedValue({ name: 'Assam' }));

    it('refuses inviting a removed member of another team into an ADC, without revealing who they were', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exec
        .mockResolvedValueOnce(null) // no active user with this email
        .mockResolvedValueOnce({ name: 'Old State Member', designation: 'DMA', adc: null }); // removed State member

      const error = await service.inviteAdcMember(inviteDto, makeAdcUser('admin')).catch((e: HttpException) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({
        code: 'EMAIL_REMOVED_OTHER_TEAM',
        message: expect.not.stringContaining('Old State Member'),
      });
      expect(mockUserModel.create).not.toHaveBeenCalled();
      expect(mockAdcAuditLog.record).not.toHaveBeenCalled();
    });

    it('still offers the restore prompt for a member removed from this same ADC', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exec
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ name: 'Old ADC Member', designation: 'Officer', adc: new Types.ObjectId(ADC_ID) });

      await expect(service.inviteAdcMember(inviteDto, makeAdcUser('admin'))).rejects.toMatchObject({
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

    it('leaves any other duplicate-key error (e.g. mobile) untouched', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const mobileDuplicate = Object.assign(new Error('E11000 mobile'), { code: 11000, keyPattern: { mobile: 1 } });
      mockUserModel.create.mockRejectedValueOnce(mobileDuplicate);

      await expect(service.inviteAdcMember(inviteDto, makeAdcUser('admin'))).rejects.toBe(mobileDuplicate);
    });
  });

  describe('a deactivated ADC', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc({ isActive: false })));

    it('refuses invites and level changes', async () => {
      await expect(service.inviteAdcMember(inviteDto, makeAdcUser('admin'))).rejects.toThrow('This ADC is not active');
      await expect(
        service.updateAdcMemberSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeAdcUser('admin')),
      ).rejects.toThrow('This ADC is not active');
      expect(mockUserModel.create).not.toHaveBeenCalled();
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('still lists and removes members, so its team can be cleaned up', async () => {
      mockUserModel.exec.mockResolvedValueOnce([]);
      await expect(service.getAdcMembers(makeAdcUser('admin'))).resolves.toEqual([]);

      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' }).mockResolvedValueOnce(undefined);
      await expect(service.removeAdcMember(TARGET_USER_ID, makeAdcUser('admin'))).resolves.toEqual({
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

    it('404s for an unknown ADC', async () => {
      mockAdcModel.exec.mockResolvedValueOnce(null);
      await expect(service.getAdcMembers(makeAdcUser('admin'))).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateAdcMemberSubrole()', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc()));

    it('changes the level and logs from/to', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' }).mockResolvedValueOnce(undefined);

      await service.updateAdcMemberSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeAdcUser('admin'));

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, {
        $set: { xviFcSubrole: 'viewer' },
      });
      expect(mockAdcAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'MEMBER_LEVEL_CHANGED',
          user: TARGET_USER_ID,
          changes: { subRole: { from: 'reviewer', to: 'viewer' } },
        }),
      );
    });

    it('writes and logs nothing when the level is unchanged', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'viewer' });

      await expect(
        service.updateAdcMemberSubrole(TARGET_USER_ID, { subRole: 'VIEWER' }, makeAdcUser('admin')),
      ).resolves.toEqual({ message: 'Sub-role updated successfully' });
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(mockAdcAuditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('removeAdcMember()', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc()));

    it('soft-deletes a reviewer of the same ADC and logs it', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' }).mockResolvedValueOnce(undefined);
      await service.removeAdcMember(TARGET_USER_ID, makeAdcUser('admin'));
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, {
        $set: { isXviFcdeleted: true, isDeleted: true },
      });
      expect(mockAdcAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'MEMBER_REMOVED', user: TARGET_USER_ID }),
      );
    });

    it('cannot remove the ADC admin, nor yourself', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'admin' });
      await expect(service.removeAdcMember(TARGET_USER_ID, makeAdcUser('admin'))).rejects.toThrow(BadRequestException);

      const self = makeAdcUser('admin', { _id: TARGET_USER_ID });
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer' });
      await expect(service.removeAdcMember(TARGET_USER_ID, self)).rejects.toThrow(BadRequestException);
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(mockAdcAuditLog.record).not.toHaveBeenCalled();
    });

    it('404s for a user who is not in that ADC', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null);
      await expect(service.removeAdcMember(TARGET_USER_ID, makeAdcUser('admin'))).rejects.toThrow(NotFoundException);
    });
  });

  describe('transferAdcSubmitter()', () => {
    beforeEach(() => mockAdcModel.exec.mockResolvedValue(adcDoc()));

    it('demotes the ADC admin to reviewer, then promotes the target, and logs a TRANSFERRED admin change', async () => {
      const requester = makeAdcUser('admin');
      const currentAdminId = new Types.ObjectId(requester._id);
      mockUserModel.exec
        .mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: true }) // target
        .mockResolvedValueOnce({ _id: currentAdminId }) // current admin
        .mockResolvedValue(undefined);

      await service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, requester);

      // Demote first: the unique index would refuse two admins at once.
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenNthCalledWith(1, currentAdminId, {
        $set: { xviFcSubrole: 'reviewer' },
      });
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
        $set: { xviFcSubrole: 'admin' },
      });
      expect(mockAdcAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ADC_ADMIN_CHANGED',
          actorRole: 'ADC_ADMIN',
          mode: 'TRANSFERRED',
          user: TARGET_USER_ID,
          changes: { admin: { from: currentAdminId, to: new Types.ObjectId(TARGET_USER_ID) } },
        }),
      );
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
      expect(mockAdcAuditLog.record).not.toHaveBeenCalled();
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
        service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('admin')),
      ).rejects.toMatchObject({ response: { code: 'ADC_ADMIN_EXISTS' } });
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenLastCalledWith(currentAdminId, {
        $set: { xviFcSubrole: 'admin' },
      });
    });

    it('refuses a transfer for an inactive ADC', async () => {
      mockAdcModel.exec.mockResolvedValue({ ...adcDoc(), isActive: false });

      await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('admin'))).rejects.toThrow(
        'This ADC is not active',
      );
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses an unverified target, the current admin, and a non-admin caller', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: false });
      await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('admin'))).rejects.toThrow(
        BadRequestException,
      );

      mockUserModel.exec.mockResolvedValueOnce({ xviFcSubrole: 'admin', isXVIFCProfileVerified: true });
      await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('admin'))).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.transferAdcSubmitter({ toUserId: TARGET_USER_ID }, makeAdcUser('reviewer'))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── Portal Admin: the ADC Admin (master/adc) ───────────────────────────

  const platformAdmin = makeStateAdmin({ scope: Scope.ADMIN, role: Role.ADMIN, state: undefined });
  const adcRef = () => ({ _id: new Types.ObjectId(ADC_ID), name: 'Test ADC', state: new Types.ObjectId(STATE_ID) });
  const adminInput = { name: 'New Admin', email: 'admin@adc.gov.in', mobile: '9876543210', designation: 'Secretary' };

  describe('createAdcAdmin()', () => {
    beforeEach(() => mockStateModel.exec.mockResolvedValue({ name: 'Assam' }));

    it('creates the ADC Admin and sends the Portal Admin invite wording', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockUserModel.create.mockResolvedValue({ _id: new Types.ObjectId(TARGET_USER_ID) });

      const member = await service.createAdcAdmin(adcRef(), adminInput, platformAdmin);

      expect(member).toEqual(expect.objectContaining({ _id: TARGET_USER_ID, subRole: 'SUBMITTER' }));
      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ xviFcSubrole: 'admin', adc: new Types.ObjectId(ADC_ID), role: Role.STATE }),
      );
      expect(mockEmailQueueService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          mailData: expect.objectContaining({
            portalInvite: true,
            adcName: 'Test ADC',
            stateName: 'Assam',
            role: 'Admin',
          }),
        }),
      );
    });

    it('turns a second admin (unique-index hit) into ADC_ADMIN_EXISTS', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockUserModel.create.mockRejectedValueOnce(
        Object.assign(new Error('E11000'), { code: 11000, keyPattern: { adc: 1, xviFcSubrole: 1 } }),
      );

      await expect(service.createAdcAdmin(adcRef(), adminInput, platformAdmin)).rejects.toMatchObject({
        response: { code: 'ADC_ADMIN_EXISTS' },
      });
      expect(mockEmailQueueService.addEmailJob).not.toHaveBeenCalled();
    });

    it('refuses an email that is active elsewhere with 409', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ _id: 'someone' });
      await expect(service.createAdcAdmin(adcRef(), adminInput, platformAdmin)).rejects.toMatchObject({
        response: { code: 'EMAIL_ALREADY_ACTIVE' },
      });
      expect(mockUserModel.create).not.toHaveBeenCalled();
    });
  });

  describe('setAdcAdmin()', () => {
    const currentAdminId = new Types.ObjectId();

    beforeEach(() => {
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockStateModel.exec.mockResolvedValue({ name: 'Assam' });
    });

    it('promotes a verified member: demotes the current Admin first, then promotes', async () => {
      mockUserModel.exec
        .mockResolvedValueOnce({ _id: currentAdminId }) // current admin
        .mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: true }); // target

      const change = await service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin);

      expect(change).toEqual(
        expect.objectContaining({ from: currentAdminId, to: new Types.ObjectId(TARGET_USER_ID), mode: 'PROMOTED' }),
      );
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenNthCalledWith(1, currentAdminId, {
        $set: { xviFcSubrole: 'reviewer' },
      });
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
        $set: { xviFcSubrole: 'admin' },
      });
    });

    it('promotes without a demote when the ADC has no Admin yet', async () => {
      mockUserModel.exec
        .mockResolvedValueOnce(null) // no admin
        .mockResolvedValueOnce({ xviFcSubrole: 'viewer', isXVIFCProfileVerified: true });

      const change = await service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin);

      expect(change.from).toBeNull();
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, { $set: { xviFcSubrole: 'admin' } });
    });

    it('refuses an unverified member, the current Admin and a non-member, changing nothing', async () => {
      mockUserModel.exec
        .mockResolvedValueOnce({ _id: currentAdminId })
        .mockResolvedValueOnce({ xviFcSubrole: 'reviewer', isXVIFCProfileVerified: false });
      await expect(
        service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin),
      ).rejects.toThrow(BadRequestException);

      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exec
        .mockResolvedValueOnce({ _id: currentAdminId })
        .mockResolvedValueOnce({ xviFcSubrole: 'admin', isXVIFCProfileVerified: true });
      await expect(
        service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin),
      ).rejects.toThrow(BadRequestException);

      mockAdcModel.exec.mockResolvedValueOnce(adcDoc());
      mockUserModel.exec.mockResolvedValueOnce({ _id: currentAdminId }).mockResolvedValueOnce(null);
      await expect(
        service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin),
      ).rejects.toThrow(NotFoundException);

      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('invites a new person as Admin after demoting the current one', async () => {
      const newAdminId = new Types.ObjectId();
      mockUserModel.exec
        .mockResolvedValueOnce({ _id: currentAdminId }) // current admin
        .mockResolvedValueOnce(undefined) // the demote
        .mockResolvedValueOnce(null) // no active user with the email
        .mockResolvedValueOnce(null); // no removed user
      mockUserModel.create.mockResolvedValue({ _id: newAdminId });

      const change = await service.setAdcAdmin(ADC_ID, { mode: 'invite', ...adminInput }, platformAdmin);

      expect(change).toEqual(expect.objectContaining({ from: currentAdminId, to: newAdminId, mode: 'INVITED' }));
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(currentAdminId, {
        $set: { xviFcSubrole: 'reviewer' },
      });
      expect(mockUserModel.create).toHaveBeenCalledWith(expect.objectContaining({ xviFcSubrole: 'admin' }));
    });

    it('re-promotes the old Admin when the invite fails', async () => {
      mockUserModel.exec
        .mockResolvedValueOnce({ _id: currentAdminId })
        .mockResolvedValueOnce(undefined) // the demote
        .mockResolvedValueOnce({ _id: 'someone-active' }); // the email is active elsewhere

      await expect(
        service.setAdcAdmin(ADC_ID, { mode: 'invite', ...adminInput }, platformAdmin),
      ).rejects.toMatchObject({ response: { code: 'EMAIL_ALREADY_ACTIVE' } });
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenLastCalledWith(currentAdminId, {
        $set: { xviFcSubrole: 'admin' },
      });
    });

    it('refuses an inactive ADC and an unknown one', async () => {
      mockAdcModel.exec.mockReset();
      mockAdcModel.exec.mockResolvedValueOnce(adcDoc({ isActive: false })).mockResolvedValueOnce(null);
      await expect(
        service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin),
      ).rejects.toThrow('This ADC is not active');
      await expect(
        service.setAdcAdmin(ADC_ID, { mode: 'promote', userId: TARGET_USER_ID }, platformAdmin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listAdcMembersForAdmin()', () => {
    const page = { page: 1, limit: 20 };
    let countDocuments: jest.Mock;

    beforeEach(() => {
      mockAdcModel.exists.mockResolvedValue({ _id: ADC_ID });
      countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      (mockUserModel as Record<string, jest.Mock>).countDocuments = countDocuments;
      mockUserModel.exec.mockResolvedValue([]);
    });

    const filterArg = () => (mockUserModel.find.mock.calls[0] as [Record<string, unknown>])[0];

    it("returns one page of the ADC's active members with display levels, status and last active", async () => {
      const adminId = new Types.ObjectId();
      const lastLoginAt = new Date('2026-11-12T10:00:00.000Z');
      mockUserModel.exec.mockResolvedValueOnce([
        {
          _id: adminId,
          name: 'A',
          designation: 'Nodal Officer',
          email: 'a@x.in',
          mobile: '9876543210',
          xviFcSubrole: 'admin',
          isXVIFCProfileVerified: true,
          lastLoginAt,
        },
        { _id: TARGET_USER_ID, name: 'B', email: 'b@x.in', xviFcSubrole: 'reviewer' },
      ]);
      countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(21) });

      await expect(service.listAdcMembersForAdmin(ADC_ID, { page: 2, limit: 20 })).resolves.toEqual({
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
        data: [
          {
            _id: String(adminId),
            name: 'A',
            designation: 'Nodal Officer',
            email: 'a@x.in',
            mobile: '9876543210',
            subRole: 'SUBMITTER',
            isXVIFCProfileVerified: true,
            lastActive: lastLoginAt.toISOString(),
          },
          {
            _id: TARGET_USER_ID,
            name: 'B',
            designation: '',
            email: 'b@x.in',
            mobile: '',
            subRole: 'EDITOR',
            isXVIFCProfileVerified: false,
            lastActive: null,
          },
        ],
      });
      expect(filterArg()).toEqual(expect.objectContaining({ adc: new Types.ObjectId(ADC_ID), isDeleted: false }));
      expect(countDocuments).toHaveBeenCalledWith(filterArg());
      expect(mockUserModel.skip).toHaveBeenCalledWith(20);
      expect(mockUserModel.limit).toHaveBeenCalledWith(20);
      expect(mockUserModel.sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
    });

    it('filters by level, verification status and leaving out the Admin', async () => {
      await service.listAdcMembersForAdmin(ADC_ID, { ...page, level: 'EDITOR', status: 'INVITED', excludeAdmin: true });

      expect(filterArg()).toEqual(
        expect.objectContaining({
          xviFcSubrole: { $eq: 'reviewer', $ne: 'admin' },
          isXVIFCProfileVerified: { $ne: true },
        }),
      );
    });

    it('finds verified non-admins only for Change Admin', async () => {
      await service.listAdcMembersForAdmin(ADC_ID, { ...page, status: 'ACTIVE', excludeAdmin: true });

      expect(filterArg()).toEqual(
        expect.objectContaining({ xviFcSubrole: { $ne: 'admin' }, isXVIFCProfileVerified: true }),
      );
    });

    it('searches name, email and mobile literally, escaping regex characters', async () => {
      await service.listAdcMembersForAdmin(ADC_ID, { ...page, search: 'a.*(b+)+' });

      const pattern = { $regex: 'a\\.\\*\\(b\\+\\)\\+', $options: 'i' };
      expect(filterArg().$or).toEqual([{ name: pattern }, { email: pattern }, { mobile: pattern }]);
    });

    it('sorts by last active, with the name as tiebreaker', async () => {
      await service.listAdcMembersForAdmin(ADC_ID, { ...page, sortBy: 'lastActive', sortDir: -1 });
      expect(mockUserModel.sort).toHaveBeenCalledWith({ lastLoginAt: -1, name: 1 });
    });

    it('404s for an unknown ADC', async () => {
      mockAdcModel.exists.mockResolvedValue(null);
      await expect(service.listAdcMembersForAdmin(ADC_ID, page)).rejects.toThrow(NotFoundException);
      expect(mockUserModel.find).not.toHaveBeenCalled();
    });
  });

  describe('removeAdcAdminAndDetachRemoved()', () => {
    const adcId = new Types.ObjectId(ADC_ID);

    it('removes the Admin, then clears adc on every removed member so their emails are free', async () => {
      const adminId = new Types.ObjectId();
      mockUserModel.exec.mockResolvedValueOnce({ _id: adminId }).mockResolvedValue(undefined);

      await expect(service.removeAdcAdminAndDetachRemoved(adcId)).resolves.toEqual(adminId);

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(adminId, {
        $set: { isXviFcdeleted: true, isDeleted: true },
      });
      expect(mockUserModel.updateMany).toHaveBeenCalledWith(
        { adc: adcId, isDeleted: true, isXviFcdeleted: true },
        { $set: { adc: null } },
      );
    });

    it('still detaches removed members when the ADC has no Admin', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null).mockResolvedValue(undefined);

      await expect(service.removeAdcAdminAndDetachRemoved(adcId)).resolves.toBeNull();
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(mockUserModel.updateMany).toHaveBeenCalled();
    });
  });

  // ─── platform Admin user API ────────────────────────────────────────────

  describe('POST users no longer creates ADC users', () => {
    it('CreateUserDto has no adcId, so the global ValidationPipe rejects it', async () => {
      const dto = plainToInstance(CreateUserDto, {
        name: 'ADC User',
        email: 'adc.user@example.com',
        mobile: '8987654321',
        designation: 'ADC Officer',
        role: Role.STATE,
        stateId: STATE_ID,
        adcId: ADC_ID,
      });
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.map((e) => e.property)).toContain('adcId');
    });

    it('adminCreateUser never stamps an ADC on the user', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null); // duplicate-email lookup
      mockStateModel.exec.mockResolvedValueOnce({ _id: new Types.ObjectId(STATE_ID) });
      mockUserModel.create.mockResolvedValue({ _id: new Types.ObjectId(TARGET_USER_ID) });

      await service.adminCreateUser(
        {
          name: 'State User',
          email: 'state.user@example.com',
          mobile: '8987654321',
          designation: 'Officer',
          role: Role.STATE,
          subRole: 'EDITOR',
          stateId: STATE_ID,
        } as never,
        platformAdmin,
      );

      expect(mockUserModel.create).toHaveBeenCalledWith(expect.not.objectContaining({ adc: expect.anything() }));
    });
  });

  describe('adminUpdateUser()', () => {
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

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';

import { UsersService } from './users.service';
import { User } from 'src/schemas/user/user.schema';
import { State } from 'src/schemas/state.schema';
import { RedisService } from 'src/core/services/redis/redis.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { EmailDomainValidationService } from 'src/core/email-domain-validation/email-domain-validation.service';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';

import {
  createChainMock,
  makeUlbAdmin,
  makeStateAdmin,
  makeMohuaAdmin,
  makeOverridesDto,
  makeUserDoc,
  ULB_ID,
  ULB_ID_2,
  STATE_ID,
  STATE_ID_2,
  TARGET_USER_ID,
} from './test/users.fixtures';

// ─── Module setup ──────────────────────────────────────────────────────────
//
// NOTE ON DRIFT FROM THE PREVIOUS VERSION OF THIS FILE:
// - `Ulb`/`State` used to be imported from `src/admin/xvi-fc/schemas/*`, which was deleted
//   in aeea981 ("optimized and removed unwanted schemas"). The real schemas now live at
//   `src/schemas/ulb.schema.ts` / `src/schemas/state.schema.ts`.
// - UsersService's current constructor does NOT inject a `Ulb` model at all (only `User`,
//   `State`, RedisService, EmailQueueService, ConfigService) — so the old `Ulb` model
//   provider has been dropped, and Redis/EmailQueue/Config providers have been added.
// - The previous spec also tested `listUsers()`, `findAll()`, `findOne()`, `update()`, and
//   `remove()` — none of these methods exist on the current UsersService (it now only
//   exposes XVI-FC-domain methods: create, invite*, updatePermissionOverrides,
//   softDelete*StateUser/MohuaMember, updateXviFcSubrole, transferSubmitter, etc). Those
//   test blocks tested API surface that no longer exists and have been removed rather than
//   patched, since there is nothing on the service left to point them at.
// - `./test/users.fixtures` (createChainMock, makeUlbAdmin, ...) was imported by the old
//   spec but was never actually committed to the repo — it has been added alongside this
//   fix so the file can compile and run at all.

describe('UsersService', () => {
  let service: UsersService;
  let mockUserModel: ReturnType<typeof createChainMock>;
  let mockStateModel: ReturnType<typeof createChainMock>;
  let mockRedisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let mockEmailQueueService: { addEmailJob: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockEmailDomainValidation: { domainHasMxRecord: jest.Mock };

  beforeEach(async () => {
    mockUserModel = createChainMock();
    mockStateModel = createChainMock();
    mockRedisService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    mockEmailQueueService = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    mockConfigService = { get: jest.fn().mockReturnValue('https://cityfinance.in') };
    mockEmailDomainValidation = { domainHasMxRecord: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(State.name), useValue: mockStateModel },
        { provide: RedisService, useValue: mockRedisService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailDomainValidationService, useValue: mockEmailDomainValidation },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── updatePermissionOverrides() ───────────────────────────────────────

  describe('updatePermissionOverrides()', () => {
    const targetId = TARGET_USER_ID;

    it('updates overrides and returns the recomputed effective permissions', async () => {
      const targetDoc = makeUserDoc({ role: Role.ULB_EDITOR, ulb: new Types.ObjectId(ULB_ID) });
      mockUserModel.exec.mockResolvedValueOnce(targetDoc).mockResolvedValueOnce(undefined);

      const dto = makeOverridesDto({ allow: [Permission.UPLOAD_DOCUMENTS] });
      const result = await service.updatePermissionOverrides(targetId, dto, makeUlbAdmin());

      expect(result.message).toBe('Permission overrides updated successfully');
      expect(result.overrides.allow).toContain(Permission.UPLOAD_DOCUMENTS);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(targetId, {
        $set: { 'permissionOverrides.allow': [Permission.UPLOAD_DOCUMENTS], 'permissionOverrides.deny': [] },
      });
    });

    it('denying a permission removes it from effectivePermissions', async () => {
      const targetDoc = makeUserDoc({
        role: Role.STATE,
        xviFcSubrole: 'reviewer',
        state: new Types.ObjectId(STATE_ID),
        ulb: undefined,
      });
      mockUserModel.exec.mockResolvedValueOnce(targetDoc).mockResolvedValueOnce(undefined);

      const dto = makeOverridesDto({ deny: [Permission.MESSAGE_USERS] });
      const result = await service.updatePermissionOverrides(targetId, dto, makeStateAdmin());

      expect(result.effectivePermissions).not.toContain(Permission.MESSAGE_USERS);
    });

    it('throws 400 when same permission appears in allow and deny', async () => {
      const targetDoc = makeUserDoc({ ulb: new Types.ObjectId(ULB_ID) });
      mockUserModel.exec.mockResolvedValueOnce(targetDoc);

      const dto = makeOverridesDto({
        allow: [Permission.MESSAGE_USERS],
        deny: [Permission.MESSAGE_USERS],
      });
      await expect(service.updatePermissionOverrides(targetId, dto, makeUlbAdmin())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when target user does not exist', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null);
      const dto = makeOverridesDto();
      await expect(service.updatePermissionOverrides(targetId, dto, makeUlbAdmin())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 400 for an invalid target user ID', async () => {
      const dto = makeOverridesDto();
      await expect(
        service.updatePermissionOverrides('not-an-object-id', dto, makeUlbAdmin()),
      ).rejects.toThrow(BadRequestException);
    });

    // Same-tenant scoping — previously flagged (see git history) as documented in the JSDoc but
    // not enforced by the code; "admin-only" itself is the route's @RequirePermissions guard's
    // job, not this service's — these tests cover the part that IS this service's job: the
    // target must belong to the requester's own ULB/state/organization.
    describe('authorization scoping — target must belong to the requester\'s own tenant', () => {
      it('rejects a STATE requester acting on a user in a different state', async () => {
        const targetDoc = makeUserDoc({ role: Role.STATE, state: new Types.ObjectId(STATE_ID_2) });
        mockUserModel.exec.mockResolvedValueOnce(targetDoc);

        await expect(
          service.updatePermissionOverrides(targetId, makeOverridesDto(), makeStateAdmin()),
        ).rejects.toThrow(ForbiddenException);
      });

      it('rejects a ULB requester acting on a user in a different ULB', async () => {
        const targetDoc = makeUserDoc({ ulb: new Types.ObjectId(ULB_ID_2) });
        mockUserModel.exec.mockResolvedValueOnce(targetDoc);

        await expect(
          service.updatePermissionOverrides(targetId, makeOverridesDto(), makeUlbAdmin()),
        ).rejects.toThrow(ForbiddenException);
      });

      it('rejects a MoHUA requester acting on a non-MoHUA user', async () => {
        const targetDoc = makeUserDoc({ role: Role.STATE, state: new Types.ObjectId(STATE_ID) });
        mockUserModel.exec.mockResolvedValueOnce(targetDoc);

        await expect(
          service.updatePermissionOverrides(targetId, makeOverridesDto(), makeMohuaAdmin()),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows a MoHUA requester to update another MoHUA user', async () => {
        const targetDoc = makeUserDoc({ role: Role.MoHUA, xviFcSubrole: 'reviewer', ulb: undefined });
        mockUserModel.exec.mockResolvedValueOnce(targetDoc).mockResolvedValueOnce(undefined);

        await expect(
          service.updatePermissionOverrides(targetId, makeOverridesDto(), makeMohuaAdmin()),
        ).resolves.toBeDefined();
      });
    });
  });

  // ─── getPermissionMatrix() / getMohuaPermissionMatrix() ────────────────

  describe('getPermissionMatrix()', () => {
    it('returns the STATE permission matrix rows', () => {
      const rows = service.getPermissionMatrix();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('getMohuaPermissionMatrix()', () => {
    it('returns the MoHUA permission matrix rows', () => {
      const rows = service.getMohuaPermissionMatrix();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('getMohuaMembers()', () => {
    it('returns the roster for a MoHUA requester', async () => {
      mockUserModel.exec.mockResolvedValueOnce([]);
      await expect(service.getMohuaMembers(makeMohuaAdmin())).resolves.toEqual([]);
    });

    it('rejects a non-MoHUA requester', async () => {
      await expect(service.getMohuaMembers(makeStateAdmin())).rejects.toThrow(ForbiddenException);
      expect(mockUserModel.find).not.toHaveBeenCalled();
    });
  });

  describe('inviteMohuaMember()', () => {
    const dto = { name: 'A', email: 'a@b.com', mobile: '9999999999', designation: 'Officer', subRole: 'VIEWER' as const };

    it('rejects a non-admin-subrole MoHUA requester', async () => {
      await expect(
        service.inviteMohuaMember(dto, makeMohuaAdmin({ xviFcSubrole: 'viewer' })),
      ).rejects.toThrow(ForbiddenException);
      expect(mockEmailDomainValidation.domainHasMxRecord).not.toHaveBeenCalled();
    });

    it('rejects a non-MoHUA requester', async () => {
      await expect(service.inviteMohuaMember(dto, makeStateAdmin())).rejects.toThrow(ForbiddenException);
      expect(mockEmailDomainValidation.domainHasMxRecord).not.toHaveBeenCalled();
    });

    it('restore: sets role back to MoHUA even if the removed document had drifted to a different role', async () => {
      const restoreDto = { ...dto, action: 'restore' as const };
      const requester = makeMohuaAdmin();
      const removedDoc = { _id: new Types.ObjectId(TARGET_USER_ID), email: dto.email, role: Role.STATE };

      mockUserModel.exec
        .mockResolvedValueOnce(null) // activeUser check — no active user with this email
        .mockResolvedValueOnce(removedDoc) // toRestore lookup
        .mockResolvedValueOnce({ ...removedDoc, role: Role.MoHUA }); // findByIdAndUpdate result
      mockUserModel.exists.mockResolvedValue(null); // no race conflict

      await service.inviteMohuaMember(restoreDto, requester);

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        removedDoc._id,
        expect.objectContaining({ $set: expect.objectContaining({ role: Role.MoHUA }) }),
        expect.any(Object),
      );
    });
  });

  describe('inviteStateMember()', () => {
    const dto = { name: 'A', email: 'a@b.com', mobile: '9999999999', designation: 'Officer', subRole: 'VIEWER' as const };

    it('restore: sets role back to STATE even if the removed document had drifted to a different role (e.g. MoHUA)', async () => {
      const restoreDto = { ...dto, action: 'restore' as const };
      const requester = makeStateAdmin();
      const removedDoc = { _id: new Types.ObjectId(TARGET_USER_ID), email: dto.email, role: Role.MoHUA };

      mockUserModel.exec
        .mockResolvedValueOnce(null) // activeUser check — no active user with this email
        .mockResolvedValueOnce(removedDoc) // toRestore lookup
        .mockResolvedValueOnce({ ...removedDoc, role: Role.STATE, state: requester.state }); // findByIdAndUpdate result
      mockUserModel.exists.mockResolvedValue(null); // no race conflict

      await service.inviteStateMember(restoreDto, requester);

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        removedDoc._id,
        expect.objectContaining({ $set: expect.objectContaining({ role: Role.STATE }) }),
        expect.any(Object),
      );
    });
  });

  // ─── issueProfileSaveToken() ─────────────────────────────────────────────

  describe('issueProfileSaveToken()', () => {
    it('issues a token and stores it in redis when the user exists', async () => {
      mockUserModel.exec.mockResolvedValueOnce({ _id: new Types.ObjectId(TARGET_USER_ID) });

      const result = await service.issueProfileSaveToken(TARGET_USER_ID);

      expect(result.token).toEqual(expect.any(String));
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `profile_save_token:${TARGET_USER_ID}`,
        result.token,
        120,
      );
    });

    it('throws 404 when the user does not exist', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null);
      await expect(service.issueProfileSaveToken(TARGET_USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws 400 for an invalid user id', async () => {
      await expect(service.issueProfileSaveToken('not-an-object-id')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── updateProfileContacts() ─────────────────────────────────────────────

  describe('updateProfileContacts()', () => {
    it('rejects a ULB self-update with no saveToken (same rule STATE/MoHUA already enforce)', async () => {
      const requester = makeUlbAdmin({ _id: TARGET_USER_ID });
      mockUserModel.exec.mockResolvedValueOnce(makeUserDoc());

      await expect(
        service.updateProfileContacts(TARGET_USER_ID, { name: 'New Name' }, requester),
      ).rejects.toThrow(BadRequestException);

      expect(mockRedisService.get).not.toHaveBeenCalled();
    });

    it('rejects a ULB self-update whose saveToken does not match what is stored in redis', async () => {
      const requester = makeUlbAdmin({ _id: TARGET_USER_ID });
      mockUserModel.exec.mockResolvedValueOnce(makeUserDoc());
      mockRedisService.get.mockResolvedValueOnce('a-different-token');

      await expect(
        service.updateProfileContacts(TARGET_USER_ID, { name: 'New Name', saveToken: 'wrong-token' }, requester),
      ).rejects.toThrow('Save token is invalid or expired. Please verify your email again.');
    });

    it('accepts a ULB self-update with a valid saveToken', async () => {
      const requester = makeUlbAdmin({ _id: TARGET_USER_ID });
      mockUserModel.exec
        .mockResolvedValueOnce(makeUserDoc())
        .mockResolvedValueOnce(makeUserDoc({ name: 'New Name' }));
      mockRedisService.get.mockResolvedValueOnce('good-token');

      await service.updateProfileContacts(TARGET_USER_ID, { name: 'New Name', saveToken: 'good-token' }, requester);

      expect(mockRedisService.del).toHaveBeenCalledWith(`profile_save_token:${TARGET_USER_ID}`);
    });
  });

  // ─── softDeleteStateUser() ───────────────────────────────────────────────

  describe('softDeleteStateUser()', () => {
    it('marks a non-admin STATE user as removed from XVI-FC without touching isDeleted', async () => {
      const targetDoc = makeUserDoc({ role: Role.STATE, xviFcSubrole: 'reviewer' });
      mockUserModel.exec.mockResolvedValueOnce(targetDoc).mockResolvedValueOnce(undefined);

      const result = await service.softDeleteStateUser(TARGET_USER_ID, makeStateAdmin());

      expect(result.message).toBe('Member removed from the XVI-FC portal');
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, {
        $set: { isXviFcdeleted: true },
      });
    });

    it('throws 400 when trying to remove the STATE admin', async () => {
      const targetDoc = makeUserDoc({ role: Role.STATE, xviFcSubrole: 'admin' });
      mockUserModel.exec.mockResolvedValueOnce(targetDoc);

      await expect(service.softDeleteStateUser(TARGET_USER_ID, makeStateAdmin())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when target user does not exist', async () => {
      mockUserModel.exec.mockResolvedValueOnce(null);
      await expect(service.softDeleteStateUser(TARGET_USER_ID, makeStateAdmin())).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

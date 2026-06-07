import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { UsersService } from './users.service';
import { User } from 'src/schemas/user/user.schema';
import { Ulb } from 'src/admin/xvi-fc/schemas/ulb.schema';
import { State } from 'src/admin/xvi-fc/schemas/state.schema';
import { Permission, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';

import {
  createChainMock,
  makeUlbAdmin,
  makeUlbEditor,
  makeUlbViewer,
  makeStateAdmin,
  makeStateEditor,
  makeStateViewer,
  makeCreateUlbEditorDto,
  makeCreateStateEditorDto,
  makeOverridesDto,
  makeUserDoc,
  ULB_ID,
  ULB_ID_2,
  STATE_ID,
  STATE_ID_2,
  TARGET_USER_ID,
} from './test/users.fixtures';

// ─── Module setup ──────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;
  let mockUserModel: ReturnType<typeof createChainMock>;
  let mockUlbModel:  ReturnType<typeof createChainMock>;
  let mockStateModel: ReturnType<typeof createChainMock>;

  beforeEach(async () => {
    mockUserModel  = createChainMock();
    mockUlbModel   = createChainMock();
    mockStateModel = createChainMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name),  useValue: mockUserModel  },
        { provide: getModelToken(Ulb.name),   useValue: mockUlbModel   },
        { provide: getModelToken(State.name), useValue: mockStateModel  },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── createManagedUser() ───────────────────────────────────────────────

  describe('createManagedUser()', () => {

    describe('ULB admin creating users', () => {
      const creator = makeUlbAdmin();

      it('creates ULB-EDITOR in the same ULB', async () => {
        const dto = makeCreateUlbEditorDto();
        const doc = makeUserDoc({ role: Role.ULB_EDITOR });

        mockUserModel.exists.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue(doc);

        const result = await service.createManagedUser(dto as any, creator);
        expect(result).toBeDefined();
        expect(mockUserModel.create).toHaveBeenCalledTimes(1);
      });

      it('creates ULB-VIEWER in the same ULB', async () => {
        const dto = makeCreateUlbEditorDto({ role: Role.ULB_VIEWER, mobile: '9000000099' });
        const doc = makeUserDoc({ role: Role.ULB_VIEWER });

        mockUserModel.exists.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue(doc);

        await expect(service.createManagedUser(dto as any, creator)).resolves.toBeDefined();
      });

      it('throws 403 when trying to create another ULB admin (ULB role)', async () => {
        const dto = makeCreateUlbEditorDto({ role: Role.ULB });
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws 403 when trying to create a STATE-EDITOR (wrong scope)', async () => {
        const dto = makeCreateUlbEditorDto({ role: Role.STATE_EDITOR });
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws 403 when dto.ulbId does not match admin ULB', async () => {
        const dto = makeCreateUlbEditorDto({ ulbId: ULB_ID_2 });
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });

      it('allows dto.ulbId that matches admin ULB (frontend hint)', async () => {
        const dto = makeCreateUlbEditorDto({ ulbId: ULB_ID });
        const doc = makeUserDoc();

        mockUserModel.exists.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue(doc);

        await expect(service.createManagedUser(dto as any, creator)).resolves.toBeDefined();
      });

      it('throws 400 when mobile already registered', async () => {
        const dto = makeCreateUlbEditorDto();
        mockUserModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('STATE admin creating users', () => {
      const creator = makeStateAdmin();

      it('creates STATE-EDITOR in the same state', async () => {
        const dto = makeCreateStateEditorDto();
        const doc = makeUserDoc({ role: Role.STATE_EDITOR, ulb: undefined });

        mockUserModel.exists.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue(doc);

        await expect(service.createManagedUser(dto as any, creator)).resolves.toBeDefined();
      });

      it('creates STATE-VIEWER in the same state', async () => {
        const dto = makeCreateStateEditorDto({ role: Role.STATE_VIEWER, mobile: '9000000099' });
        const doc = makeUserDoc({ role: Role.STATE_VIEWER, ulb: undefined });

        mockUserModel.exists.mockResolvedValue(null);
        mockUserModel.create.mockResolvedValue(doc);

        await expect(service.createManagedUser(dto as any, creator)).resolves.toBeDefined();
      });

      it('throws 403 when trying to create another STATE admin (STATE role)', async () => {
        const dto = makeCreateStateEditorDto({ role: Role.STATE });
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws 403 when dto.stateId does not match admin state', async () => {
        const dto = makeCreateStateEditorDto({ stateId: STATE_ID_2 });
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws 403 when dto contains ulbId (STATE admin should not assign ULB)', async () => {
        const dto = makeCreateStateEditorDto({ ulbId: ULB_ID });
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('non-admin roles cannot create users', () => {
      it.each([
        ['ULB-EDITOR',   makeUlbEditor()],
        ['ULB-VIEWER',   makeUlbViewer()],
        ['STATE-EDITOR', makeStateEditor()],
        ['STATE-VIEWER', makeStateViewer()],
      ])('throws 403 for %s', async (_label, creator) => {
        const dto = makeCreateUlbEditorDto();
        await expect(service.createManagedUser(dto as any, creator))
          .rejects.toThrow(ForbiddenException);
      });
    });
  });

  // ─── updatePermissionOverrides() ───────────────────────────────────────

  describe('updatePermissionOverrides()', () => {
    const targetId = TARGET_USER_ID;

    describe('ULB admin overriding permissions', () => {
      const requester = makeUlbAdmin();

      it('updates overrides when target user is in the same ULB', async () => {
        const targetDoc = makeUserDoc({ ulb: new Types.ObjectId(ULB_ID) });
        mockUserModel.exec.mockResolvedValue(targetDoc);
        mockUserModel.findByIdAndUpdate.mockReturnThis();

        const dto = makeOverridesDto({ allow: [Permission.UPLOAD_DOCUMENTS] });
        const result = await service.updatePermissionOverrides(targetId, dto, requester);

        expect(result.message).toBe('Permission overrides updated successfully');
        expect(result.overrides.allow).toContain(Permission.UPLOAD_DOCUMENTS);
        expect(result.effectivePermissions).toContain(Permission.UPLOAD_DOCUMENTS);
      });

      it('throws 403 when target user is in a different ULB', async () => {
        const targetDoc = makeUserDoc({ ulb: new Types.ObjectId(ULB_ID_2) });
        mockUserModel.exec.mockResolvedValue(targetDoc);

        const dto = makeOverridesDto({ allow: [Permission.APPROVE_ULB_SUBMISSIONS] });
        await expect(service.updatePermissionOverrides(targetId, dto, requester))
          .rejects.toThrow(ForbiddenException);
      });

      it('denying a permission removes it from effectivePermissions', async () => {
        const targetDoc = makeUserDoc({ role: Role.ULB_EDITOR, ulb: new Types.ObjectId(ULB_ID) });
        mockUserModel.exec.mockResolvedValue(targetDoc);
        mockUserModel.findByIdAndUpdate.mockReturnThis();

        const dto = makeOverridesDto({ deny: [Permission.MESSAGE_USERS] });
        const result = await service.updatePermissionOverrides(targetId, dto, requester);

        expect(result.effectivePermissions).not.toContain(Permission.MESSAGE_USERS);
      });

      it('throws 400 when same permission appears in allow and deny', async () => {
        const targetDoc = makeUserDoc({ ulb: new Types.ObjectId(ULB_ID) });
        mockUserModel.exec.mockResolvedValue(targetDoc);

        const dto = makeOverridesDto({
          allow: [Permission.MESSAGE_USERS],
          deny:  [Permission.MESSAGE_USERS],
        });
        await expect(service.updatePermissionOverrides(targetId, dto, requester))
          .rejects.toThrow(BadRequestException);
      });
    });

    describe('STATE admin overriding permissions', () => {
      const requester = makeStateAdmin();

      it('updates overrides when target user is in the same state', async () => {
        const targetDoc = makeUserDoc({
          role:  Role.STATE_EDITOR,
          ulb:   undefined,
          state: new Types.ObjectId(STATE_ID),
        });
        mockUserModel.exec.mockResolvedValue(targetDoc);
        mockUserModel.findByIdAndUpdate.mockReturnThis();

        const dto = makeOverridesDto({ allow: [Permission.APPROVE_ULB_SUBMISSIONS] });
        const result = await service.updatePermissionOverrides(targetId, dto, requester);

        expect(result.message).toBe('Permission overrides updated successfully');
        expect(result.effectivePermissions).toContain(Permission.APPROVE_ULB_SUBMISSIONS);
      });

      it('throws 403 when target user is in a different state', async () => {
        const targetDoc = makeUserDoc({
          role:  Role.STATE_EDITOR,
          ulb:   undefined,
          state: new Types.ObjectId(STATE_ID_2),
        });
        mockUserModel.exec.mockResolvedValue(targetDoc);

        const dto = makeOverridesDto();
        await expect(service.updatePermissionOverrides(targetId, dto, requester))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('non-admin roles cannot override permissions', () => {
      it.each([
        ['ULB-EDITOR',   makeUlbEditor()],
        ['ULB-VIEWER',   makeUlbViewer()],
        ['STATE-EDITOR', makeStateEditor()],
        ['STATE-VIEWER', makeStateViewer()],
      ])('throws 403 for %s', async (_label, requester) => {
        const targetDoc = makeUserDoc();
        mockUserModel.exec.mockResolvedValue(targetDoc);

        const dto = makeOverridesDto();
        await expect(service.updatePermissionOverrides(targetId, dto, requester))
          .rejects.toThrow(ForbiddenException);
      });
    });

    it('throws 404 when target user does not exist', async () => {
      mockUserModel.exec.mockResolvedValue(null);
      const dto = makeOverridesDto();
      await expect(service.updatePermissionOverrides(targetId, dto, makeUlbAdmin()))
        .rejects.toThrow(NotFoundException);
    });

    it('throws 400 for an invalid target user ID', async () => {
      const dto = makeOverridesDto();
      await expect(service.updatePermissionOverrides('not-an-object-id', dto, makeUlbAdmin()))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── listUsers() ──────────────────────────────────────────────────────

  describe('listUsers()', () => {

    // Helper: set up the full chain for find() used inside listUsers
    function mockFindUsers(docs: any[]) {
      mockUserModel.exec.mockResolvedValue(docs);
      mockUlbModel.exec.mockResolvedValue({
        name: 'Test ULB',
        code: 'ULB001',
        state: { name: 'Test State' },
      });
      mockStateModel.exec.mockResolvedValue({ name: 'Test State', code: 'ST01' });
    }

    describe('ULB-scoped requesters (ULB, ULB-EDITOR, ULB-VIEWER)', () => {

      it.each([
        ['ULB admin',  makeUlbAdmin()],
        ['ULB-EDITOR', makeUlbEditor()],
        ['ULB-VIEWER', makeUlbViewer()],
      ])('%s: locks query to their own ULB regardless of query param', async (_label, requester) => {
        mockFindUsers([]);

        const result = await service.listUsers({}, requester);

        // userModel.find must have been called with the requester's own ulb
        const findArg = mockUserModel.find.mock.calls[0][0];
        expect(findArg.ulb.toString()).toBe(ULB_ID);
        expect(result.data).toEqual([]);
      });

      it('allows query.ulbId when it matches the requester ULB', async () => {
        mockFindUsers([]);
        const requester = makeUlbAdmin();

        await expect(service.listUsers({ ulbId: ULB_ID }, requester)).resolves.toBeDefined();
      });

      it('throws 403 when query.ulbId is a different ULB', async () => {
        const requester = makeUlbAdmin();
        await expect(service.listUsers({ ulbId: ULB_ID_2 }, requester))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws 403 when requester is not mapped to any ULB', async () => {
        const requester = makeUlbAdmin({ ulb: undefined });
        await expect(service.listUsers({}, requester))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('STATE-scoped requesters (STATE, STATE-EDITOR, STATE-VIEWER)', () => {

      it.each([
        ['STATE admin',  makeStateAdmin()],
        ['STATE-EDITOR', makeStateEditor()],
        ['STATE-VIEWER', makeStateViewer()],
      ])('%s: locks query to their own state', async (_label, requester) => {
        mockFindUsers([]);

        const result = await service.listUsers({}, requester);

        const findArg = mockUserModel.find.mock.calls[0][0];
        expect(findArg.state.toString()).toBe(STATE_ID);
        expect(result.data).toEqual([]);
      });

      it('allows query.stateId when it matches the requester state', async () => {
        mockFindUsers([]);
        const requester = makeStateAdmin();

        await expect(service.listUsers({ stateId: STATE_ID }, requester)).resolves.toBeDefined();
      });

      it('throws 403 when query.stateId is a different state', async () => {
        const requester = makeStateAdmin();
        await expect(service.listUsers({ stateId: STATE_ID_2 }, requester))
          .rejects.toThrow(ForbiddenException);
      });

      it('throws 403 when requester is not mapped to any state', async () => {
        const requester = makeStateAdmin({ state: undefined });
        await expect(service.listUsers({}, requester))
          .rejects.toThrow(ForbiddenException);
      });
    });

    describe('deduplication — legacy contacts vs real users', () => {
      it('suppresses legacy contact when same mobile exists as a real user document', async () => {
        const sharedMobile = '9876543210';

        const mainUser = {
          _id: new Types.ObjectId(),
          name: 'Main ULB User',
          mobile: sharedMobile,
          role: Role.ULB,
          email: 'main@ulb.gov',
          designation: '',
          status: 'APPROVED',
          isActive: true,
          isXVIFCProfileVerified: true,
          // Same number embedded as commissioner
          commissionerName: 'Old Commissioner',
          commissionerEmail: '',
          commissionerConatactNumber: sharedMobile,
          accountantName: '', accountantEmail: '', accountantConatactNumber: '',
          departmentName: '', departmentEmail: '', departmentContactNumber: '',
        };

        mockFindUsers([mainUser]);

        const result = await service.listUsers({}, makeUlbAdmin());

        const names = result.data.map((r) => r['name']);
        expect(names).toContain('Main ULB User');
        expect(names).not.toContain('Old Commissioner');
      });

      it('shows legacy contact when it has a unique mobile not in any real user', async () => {
        const mainUser = {
          _id: new Types.ObjectId(),
          name: 'Main ULB User',
          mobile: '9111111111',
          role: Role.ULB,
          email: 'main@ulb.gov',
          designation: '',
          status: 'APPROVED',
          isActive: true,
          isXVIFCProfileVerified: true,
          accountantName: 'Unique Accountant',
          accountantEmail: 'acc@ulb.gov',
          accountantConatactNumber: '9222222222',  // different number
          commissionerName: '', commissionerEmail: '', commissionerConatactNumber: '',
          departmentName: '', departmentEmail: '', departmentContactNumber: '',
        };

        mockFindUsers([mainUser]);

        const result = await service.listUsers({}, makeUlbAdmin());

        const names = result.data.map((r) => r['name']);
        expect(names).toContain('Main ULB User');
        expect(names).toContain('Unique Accountant');
      });
    });
  });

  // ─── Basic CRUD (kept from original spec) ─────────────────────────────

  describe('findAll()', () => {
    it('returns all users', async () => {
      const users = [makeUserDoc(), makeUserDoc({ _id: new Types.ObjectId() })];
      mockUserModel.exec.mockResolvedValue(users);

      const result = await service.findAll();
      expect(result).toEqual(users);
      expect(mockUserModel.find).toHaveBeenCalled();
    });

    it('returns empty array when no users exist', async () => {
      mockUserModel.exec.mockResolvedValue([]);
      expect(await service.findAll()).toEqual([]);
    });

    it('propagates database errors', async () => {
      mockUserModel.exec.mockRejectedValue(new Error('DB error'));
      await expect(service.findAll()).rejects.toThrow('DB error');
    });
  });

  describe('findOne()', () => {
    it('finds user by id', async () => {
      const doc = makeUserDoc();
      mockUserModel.exec.mockResolvedValue(doc);

      const result = await service.findOne(TARGET_USER_ID);
      expect(mockUserModel.findById).toHaveBeenCalledWith(TARGET_USER_ID);
      expect(result).toEqual(doc);
    });

    it('returns null when user does not exist', async () => {
      mockUserModel.exec.mockResolvedValue(null);
      expect(await service.findOne(TARGET_USER_ID)).toBeNull();
    });
  });

  describe('update()', () => {
    it('updates a user by id', async () => {
      const updated = makeUserDoc({ name: 'Updated' });
      mockUserModel.exec.mockResolvedValue(updated);

      const result = await service.update(TARGET_USER_ID, { name: 'Updated' } as any);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(TARGET_USER_ID, { name: 'Updated' }, { new: true });
      expect(result).toEqual(updated);
    });

    it('returns null when user does not exist', async () => {
      mockUserModel.exec.mockResolvedValue(null);
      expect(await service.update(TARGET_USER_ID, {} as any)).toBeNull();
    });
  });

  describe('remove()', () => {
    it('deletes user by id', async () => {
      const doc = makeUserDoc();
      mockUserModel.exec.mockResolvedValue(doc);

      const result = await service.remove(TARGET_USER_ID);
      expect(mockUserModel.findByIdAndDelete).toHaveBeenCalledWith(TARGET_USER_ID);
      expect(result).toEqual(doc);
    });

    it('returns null when user does not exist', async () => {
      mockUserModel.exec.mockResolvedValue(null);
      expect(await service.remove(TARGET_USER_ID)).toBeNull();
    });
  });
});

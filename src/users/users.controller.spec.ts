import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Types } from 'mongoose';

import { makeStateAdmin, makeUlbAdmin, TARGET_USER_ID } from './test/users.fixtures';

// ─── NOTE ON DRIFT FROM THE PREVIOUS VERSION OF THIS FILE ──────────────────
//
// The previous spec exercised `findAll()`, `findOne()`, `update()`, and `remove()` on
// UsersController — none of these methods exist on the controller anymore (see
// src/users/users.controller.ts). It has since been rewritten around XVI-FC-specific
// workflows (invite/transfer/soft-delete members, permission overrides, profile contacts,
// etc). Those test blocks have been replaced with delegation tests for the methods that
// actually exist today.
//
// `CreateUserDto` is now an empty class (`export class CreateUserDto {}`), so the old
// `email/name/password` shaped literal is no longer a real DTO shape — it is now
// constructed without an explicit `: CreateUserDto` type annotation so as not to assert a
// DTO contract the class doesn't declare.

describe('UsersController', () => {
  let controller: UsersController;

  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    email: 'test@example.com',
    name: 'Test User',
    role: 'ULB',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUsersService = {
    create: jest.fn(),
    inviteStateMember: jest.fn(),
    getPermissionMatrix: jest.fn(),
    getStateMembers: jest.fn(),
    issueProfileSaveToken: jest.fn(),
    getMohuaPermissionMatrix: jest.fn(),
    getMohuaMembers: jest.fn(),
    patchMohuaCoreSubroles: jest.fn(),
    inviteMohuaMember: jest.fn(),
    transferMohuaSubmitter: jest.fn(),
    updateMohuaMemberSubrole: jest.fn(),
    softDeleteMohuaMember: jest.fn(),
    getProfileContacts: jest.fn(),
    updateProfileContacts: jest.fn(),
    updatePermissionOverrides: jest.fn(),
    transferSubmitter: jest.fn(),
    updateXviFcSubrole: jest.fn(),
    softDeleteStateUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create()', () => {
    it('delegates to usersService.create()', async () => {
      const createUserDto = { name: 'New User', email: 'newuser@example.com', password: 'password123' };
      mockUsersService.create.mockResolvedValue(mockUser);

      const result = await controller.create(createUserDto);

      expect(result).toEqual(mockUser);
      expect(mockUsersService.create).toHaveBeenCalledWith(createUserDto);
      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the service', async () => {
      const createUserDto = { name: 'New User', email: 'newuser@example.com', password: 'password123' };
      mockUsersService.create.mockRejectedValue(new Error('User already exists'));

      await expect(controller.create(createUserDto)).rejects.toThrow('User already exists');
    });
  });

  describe('inviteStateMember()', () => {
    it('delegates to usersService.inviteStateMember() with the current user', async () => {
      const dto = { name: 'A', email: 'a@b.com', mobile: '9999999999', designation: 'Officer', subRole: 'EDITOR' as const };
      const user = makeStateAdmin();
      const response = { _id: TARGET_USER_ID, name: dto.name, mobile: dto.mobile, email: dto.email, designation: dto.designation, subRole: dto.subRole, isActive: true, isXVIFCProfileVerified: false, lastActive: null };
      mockUsersService.inviteStateMember.mockResolvedValue(response);

      const result = await controller.inviteStateMember(dto, user);

      expect(result).toEqual(response);
      expect(mockUsersService.inviteStateMember).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('getPermissionMatrix()', () => {
    it('delegates to usersService.getPermissionMatrix()', () => {
      const rows = [{ label: 'x' }];
      mockUsersService.getPermissionMatrix.mockReturnValue(rows);

      expect(controller.getPermissionMatrix()).toEqual(rows);
      expect(mockUsersService.getPermissionMatrix).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStateMembers()', () => {
    it('reads stateId off the JWT user and delegates to usersService.getStateMembers()', async () => {
      const user = makeStateAdmin();
      const members = [{ _id: TARGET_USER_ID }];
      mockUsersService.getStateMembers.mockResolvedValue(members);

      const result = await controller.getStateMembers(user as any);

      expect(result).toEqual(members);
      expect(mockUsersService.getStateMembers).toHaveBeenCalledWith(user.state?.toString());
    });

    it('throws ForbiddenException when the current user has no state scope', () => {
      const user = makeStateAdmin({ state: undefined });

      // getStateMembers throws synchronously (before returning a promise), so this must be
      // asserted with a wrapping function + toThrow rather than the async `.rejects` form.
      expect(() => controller.getStateMembers(user as any)).toThrow(ForbiddenException);
      expect(mockUsersService.getStateMembers).not.toHaveBeenCalled();
    });
  });

  describe('issueProfileSaveToken()', () => {
    it('delegates to usersService.issueProfileSaveToken()', async () => {
      mockUsersService.issueProfileSaveToken.mockResolvedValue({ token: 'abc' });

      const result = await controller.issueProfileSaveToken(TARGET_USER_ID);

      expect(result).toEqual({ token: 'abc' });
      expect(mockUsersService.issueProfileSaveToken).toHaveBeenCalledWith(TARGET_USER_ID);
    });
  });

  describe('getMohuaPermissionMatrix()', () => {
    it('delegates to usersService.getMohuaPermissionMatrix()', () => {
      const rows = [{ label: 'y' }];
      mockUsersService.getMohuaPermissionMatrix.mockReturnValue(rows);

      expect(controller.getMohuaPermissionMatrix()).toEqual(rows);
    });
  });

  describe('getMohuaMembers()', () => {
    it('delegates to usersService.getMohuaMembers()', async () => {
      const members = [{ _id: TARGET_USER_ID }];
      mockUsersService.getMohuaMembers.mockResolvedValue(members);

      expect(await controller.getMohuaMembers()).toEqual(members);
    });
  });

  describe('patchMohuaCoreSubroles()', () => {
    it('delegates to usersService.patchMohuaCoreSubroles() with the current user', async () => {
      const user = makeStateAdmin();
      mockUsersService.patchMohuaCoreSubroles.mockResolvedValue({ updated: [], notFound: [] });

      const result = await controller.patchMohuaCoreSubroles(user as any);

      expect(result).toEqual({ updated: [], notFound: [] });
      expect(mockUsersService.patchMohuaCoreSubroles).toHaveBeenCalledWith(user);
    });
  });

  describe('inviteMohuaMember()', () => {
    it('delegates to usersService.inviteMohuaMember()', async () => {
      const dto = { name: 'A', email: 'a@b.com', mobile: '9999999999', designation: 'Officer', subRole: 'VIEWER' as const };
      const user = makeStateAdmin();
      mockUsersService.inviteMohuaMember.mockResolvedValue({ _id: TARGET_USER_ID });

      const result = await controller.inviteMohuaMember(dto, user as any);

      expect(result).toEqual({ _id: TARGET_USER_ID });
      expect(mockUsersService.inviteMohuaMember).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('transferMohuaSubmitter()', () => {
    it('delegates to usersService.transferMohuaSubmitter()', async () => {
      const dto = { toUserId: TARGET_USER_ID };
      const user = makeStateAdmin();
      mockUsersService.transferMohuaSubmitter.mockResolvedValue({ message: 'ok' });

      const result = await controller.transferMohuaSubmitter(dto, user as any);

      expect(result).toEqual({ message: 'ok' });
      expect(mockUsersService.transferMohuaSubmitter).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('updateMohuaMemberSubrole()', () => {
    it('delegates to usersService.updateMohuaMemberSubrole()', async () => {
      const dto = { subRole: 'EDITOR' as const };
      const user = makeStateAdmin();
      mockUsersService.updateMohuaMemberSubrole.mockResolvedValue({ message: 'ok' });

      const result = await controller.updateMohuaMemberSubrole(TARGET_USER_ID, dto, user as any);

      expect(result).toEqual({ message: 'ok' });
      expect(mockUsersService.updateMohuaMemberSubrole).toHaveBeenCalledWith(TARGET_USER_ID, dto, user);
    });
  });

  describe('softDeleteMohuaMember()', () => {
    it('delegates to usersService.softDeleteMohuaMember()', async () => {
      const user = makeStateAdmin();
      mockUsersService.softDeleteMohuaMember.mockResolvedValue({ message: 'removed' });

      const result = await controller.softDeleteMohuaMember(TARGET_USER_ID, user as any);

      expect(result).toEqual({ message: 'removed' });
      expect(mockUsersService.softDeleteMohuaMember).toHaveBeenCalledWith(TARGET_USER_ID, user);
    });
  });

  describe('getProfileContacts()', () => {
    it('delegates to usersService.getProfileContacts()', async () => {
      const response = { commissionerName: '' };
      mockUsersService.getProfileContacts.mockResolvedValue(response);

      const result = await controller.getProfileContacts(TARGET_USER_ID);

      expect(result).toEqual(response);
      expect(mockUsersService.getProfileContacts).toHaveBeenCalledWith(TARGET_USER_ID);
    });
  });

  describe('updateProfileContacts()', () => {
    it('delegates to usersService.updateProfileContacts()', async () => {
      const dto = { commissionerName: 'New Name' };
      const user = makeUlbAdmin();
      mockUsersService.updateProfileContacts.mockResolvedValue({ message: 'ok', updatedFields: dto });

      const result = await controller.updateProfileContacts(TARGET_USER_ID, dto as any, user as any);

      expect(result).toEqual({ message: 'ok', updatedFields: dto });
      expect(mockUsersService.updateProfileContacts).toHaveBeenCalledWith(TARGET_USER_ID, dto, user);
    });
  });

  describe('updatePermissionOverrides()', () => {
    it('delegates to usersService.updatePermissionOverrides()', async () => {
      const dto = { allow: [], deny: [] };
      const user = makeUlbAdmin();
      const response = { message: 'ok', overrides: dto, effectivePermissions: [] };
      mockUsersService.updatePermissionOverrides.mockResolvedValue(response);

      const result = await controller.updatePermissionOverrides(TARGET_USER_ID, dto, user as any);

      expect(result).toEqual(response);
      expect(mockUsersService.updatePermissionOverrides).toHaveBeenCalledWith(TARGET_USER_ID, dto, user);
    });

    it('propagates errors from the service', async () => {
      const dto = { allow: [], deny: [] };
      const user = makeUlbAdmin();
      mockUsersService.updatePermissionOverrides.mockRejectedValue(new Error('Invalid user ID'));

      await expect(controller.updatePermissionOverrides('invalid-id', dto, user as any)).rejects.toThrow(
        'Invalid user ID',
      );
    });
  });

  describe('transferSubmitter()', () => {
    it('delegates to usersService.transferSubmitter()', async () => {
      const dto = { toUserId: TARGET_USER_ID };
      const user = makeStateAdmin();
      mockUsersService.transferSubmitter.mockResolvedValue({ message: 'ok' });

      const result = await controller.transferSubmitter(dto, user as any);

      expect(result).toEqual({ message: 'ok' });
      expect(mockUsersService.transferSubmitter).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('updateXviFcSubrole()', () => {
    it('delegates to usersService.updateXviFcSubrole()', async () => {
      const dto = { subRole: 'VIEWER' as const };
      const user = makeStateAdmin();
      mockUsersService.updateXviFcSubrole.mockResolvedValue({ message: 'ok' });

      const result = await controller.updateXviFcSubrole(TARGET_USER_ID, dto, user as any);

      expect(result).toEqual({ message: 'ok' });
      expect(mockUsersService.updateXviFcSubrole).toHaveBeenCalledWith(TARGET_USER_ID, dto, user);
    });
  });

  describe('softDeleteStateUser()', () => {
    it('delegates to usersService.softDeleteStateUser()', async () => {
      const user = makeStateAdmin();
      mockUsersService.softDeleteStateUser.mockResolvedValue({ message: 'ok' });

      const result = await controller.softDeleteStateUser(TARGET_USER_ID, user as any);

      expect(result).toEqual({ message: 'ok' });
      expect(mockUsersService.softDeleteStateUser).toHaveBeenCalledWith(TARGET_USER_ID, user);
    });

    it('propagates errors from the service', async () => {
      const user = makeStateAdmin();
      mockUsersService.softDeleteStateUser.mockRejectedValue(new Error('User not found'));

      await expect(controller.softDeleteStateUser(TARGET_USER_ID, user as any)).rejects.toThrow('User not found');
    });
  });
});

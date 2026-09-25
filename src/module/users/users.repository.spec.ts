import { Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersRepository } from './users.repository';
import { User } from 'src/schemas/user/user.schema';
import { Role } from 'src/module/auth/enum/role.enum';

function chain(resolvedValue: unknown) {
  const exec = jest.fn().mockResolvedValue(resolvedValue);
  const select = jest.fn().mockReturnValue({ exec });
  return { exec, select };
}

describe('UsersRepository', () => {
  let repository: UsersRepository;
  let mockUserModel: { findOne: jest.Mock };

  beforeEach(async () => {
    mockUserModel = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersRepository, { provide: getModelToken(User.name), useValue: mockUserModel }],
    }).compile();

    repository = module.get<UsersRepository>(UsersRepository);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── findByEmail — role-collision preference ───────────────────────────────

  describe('findByEmail', () => {
    it('returns the non-ULB match when one exists, without a fallback lookup', async () => {
      const stateUser = { _id: new Types.ObjectId(), role: Role.STATE };
      mockUserModel.findOne.mockReturnValueOnce(chain(stateUser));

      const result = await repository.findByEmail('User@Example.com');

      expect(mockUserModel.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'user@example.com', role: { $ne: Role.ULB } });
      expect(result).toBe(stateUser);
    });

    it('falls back to a ULB match when no non-ULB account shares the email', async () => {
      const ulbUser = { _id: new Types.ObjectId(), role: Role.ULB };
      mockUserModel.findOne.mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(ulbUser));

      const result = await repository.findByEmail('ulb@example.com');

      expect(mockUserModel.findOne).toHaveBeenNthCalledWith(1, { email: 'ulb@example.com', role: { $ne: Role.ULB } });
      expect(mockUserModel.findOne).toHaveBeenNthCalledWith(2, { email: 'ulb@example.com' });
      expect(result).toBe(ulbUser);
    });

    it('returns null when no account has the email at all', async () => {
      mockUserModel.findOne.mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(null));

      const result = await repository.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  // ─── findByIdentifierWithSensitiveFields — login() path ────────────────────

  describe('findByIdentifierWithSensitiveFields', () => {
    it('prefers a non-ULB match for an email identifier', async () => {
      const stateUser = { _id: new Types.ObjectId(), role: Role.STATE };
      mockUserModel.findOne.mockReturnValueOnce(chain(stateUser));

      const result = await repository.findByIdentifierWithSensitiveFields('User@Example.com');

      expect(mockUserModel.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'user@example.com',
        isDeleted: false,
        isActive: true,
        role: { $ne: Role.ULB },
      });
      expect(result).toBe(stateUser);
    });

    it('falls back to a ULB match when that is the only one sharing the email', async () => {
      const ulbUser = { _id: new Types.ObjectId(), role: Role.ULB };
      mockUserModel.findOne.mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(ulbUser));

      const result = await repository.findByIdentifierWithSensitiveFields('shared@example.com');

      expect(mockUserModel.findOne).toHaveBeenNthCalledWith(2, {
        email: 'shared@example.com',
        isDeleted: false,
        isActive: true,
      });
      expect(result).toBe(ulbUser);
    });

    it('does not apply the role preference for a non-email identifier', async () => {
      const user = { _id: new Types.ObjectId(), role: Role.ULB };
      mockUserModel.findOne.mockReturnValueOnce(chain(user));

      const result = await repository.findByIdentifierWithSensitiveFields('9876543210');

      expect(mockUserModel.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        $or: [{ censusCode: '9876543210' }, { sbCode: '9876543210' }, { mobile: '9876543210' }],
        isDeleted: false,
        isActive: true,
      });
      expect(result).toBe(user);
    });
  });

  // ─── findByIdentifier / findByIdentifierWithOtpFields — resolveByIdentifier() email path ──

  describe('findByIdentifier (email path)', () => {
    it('prefers a non-ULB match', async () => {
      const stateUser = { _id: new Types.ObjectId(), role: Role.STATE };
      mockUserModel.findOne.mockReturnValueOnce(chain(stateUser));

      const result = await repository.findByIdentifier('User@Example.com');

      expect(mockUserModel.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'user@example.com',
        role: { $ne: Role.ULB },
        isDeleted: false,
      });
      expect(result).toBe(stateUser);
    });

    it('falls back to a ULB match when that is the only one sharing the email', async () => {
      const ulbUser = { _id: new Types.ObjectId(), role: Role.ULB };
      mockUserModel.findOne.mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(ulbUser));

      const result = await repository.findByIdentifier('shared@example.com');

      expect(mockUserModel.findOne).toHaveBeenNthCalledWith(2, { email: 'shared@example.com', isDeleted: false });
      expect(result).toBe(ulbUser);
    });
  });

  describe('findByIdentifierWithOtpFields (email path)', () => {
    it('prefers a non-ULB match and selects OTP fields', async () => {
      const stateUser = { _id: new Types.ObjectId(), role: Role.STATE };
      const selectedChain = chain(stateUser);
      mockUserModel.findOne.mockReturnValueOnce(selectedChain);

      const result = await repository.findByIdentifierWithOtpFields('User@Example.com');

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'user@example.com',
        role: { $ne: Role.ULB },
        isDeleted: false,
      });
      expect(selectedChain.select).toHaveBeenCalledWith('+otpHash +loginAttempts +lockUntil +isLocked');
      expect(result).toBe(stateUser);
    });
  });
});

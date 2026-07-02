import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import axios from 'axios';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { BankAccountService } from './bank-account.service';
import { GetBankAccountProofSignedUrlDto } from './dto/get-bank-account-proof-signed-url.dto';
import {
  ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES,
  MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES,
} from './dto/submit-xvi-fc-bank-account.dto';
import type { SubmitXviFcBankAccountDto } from './dto/submit-xvi-fc-bank-account.dto';
import { decryptAccountNumber } from './utils/bank-account-security.util';

function q<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('BankAccountService scope enforcement', () => {
  let service: BankAccountService;
  let bankAccountModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let ulbModel: { findById: jest.Mock };
  let s3UploadService: { generatePutSignedUrl: jest.Mock };
  const originalEncryptionKey = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  const originalHashSecret = process.env.BANK_ACCOUNT_HASH_SECRET;

  const ulbId = new Types.ObjectId();
  const otherUlbId = new Types.ObjectId();
  const stateId = new Types.ObjectId();
  const otherStateId = new Types.ObjectId();

  const makeUser = (overrides: Partial<AuthUser>): AuthUser =>
    ({
      _id: new Types.ObjectId().toString(),
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
      state: null,
      ulb: null,
      ...overrides,
    }) as AuthUser;

  const makeSubmitDto = (overrides: Partial<SubmitXviFcBankAccountDto> = {}): SubmitXviFcBankAccountDto =>
    ({
      ulbId: ulbId.toString(),
      designYearId: new Types.ObjectId().toString(),
      ifscCode: 'SBIN0123456',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789012',
      bankDetails: {
        name: 'State Bank of India',
        branch: 'Main',
        address: 'MG Road',
        city: 'Bhopal',
        state: 'Madhya Pradesh',
        micr: null,
      },
      proof: {
        fileName: 'proof.pdf',
        fileUrl: 's3://bucket/proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      },
      ...overrides,
    }) as SubmitXviFcBankAccountDto;

  beforeEach(() => {
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.BANK_ACCOUNT_HASH_SECRET = 'test-bank-account-hash-secret';

    bankAccountModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    ulbModel = {
      findById: jest.fn(),
    };
    s3UploadService = {
      generatePutSignedUrl: jest.fn().mockResolvedValue({
        url: 'https://bucket.s3.amazonaws.com/xvi-fc/ulb/signed.pdf?signature=abc',
        fileAlias: 'proof_alias.pdf',
        fileUrl: 'https://bucket.s3.amazonaws.com/xvi-fc/ulb/signed.pdf',
        path: 'xvi-fc/ulb/signed.pdf',
        fileSize: 1024,
        pages: undefined,
      }),
    };

    service = new BankAccountService(bankAccountModel as never, ulbModel as never, s3UploadService as never);
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
    } else {
      process.env.BANK_ACCOUNT_ENCRYPTION_KEY = originalEncryptionKey;
    }

    if (originalHashSecret === undefined) {
      delete process.env.BANK_ACCOUNT_HASH_SECRET;
    } else {
      process.env.BANK_ACCOUNT_HASH_SECRET = originalHashSecret;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows a ULB user to access their own ULB', async () => {
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await expect(service.assertCanReadBankAccount(user, ulbId.toString())).resolves.toBeUndefined();
  });

  it('rejects a ULB user accessing another ULB', async () => {
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await expect(service.assertCanReadBankAccount(user, otherUlbId.toString())).rejects.toThrow(ForbiddenException);
  });

  it('resolves a ULB user request without ulbId to their own ULB', async () => {
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await expect(service.resolveEffectiveUlbId(user)).resolves.toBe(ulbId.toString());
  });

  it('rejects ULB_VIEWER submit', async () => {
    const user = makeUser({
      role: UserRole.ULB_VIEWER,
      scope: Scope.ULB,
      accessLevel: AccessLevel.VIEWER,
      ulb: ulbId,
    });

    await expect(service.assertCanSubmitBankAccount(user, ulbId.toString())).rejects.toThrow(ForbiddenException);
  });

  it('allows ADMIN read and submit with requested ulbId', async () => {
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });

    await expect(service.resolveEffectiveUlbId(user, ulbId.toString())).resolves.toBe(ulbId.toString());
    await expect(service.assertCanReadBankAccount(user, ulbId.toString())).resolves.toBeUndefined();
    await expect(service.assertCanSubmitBankAccount(user, ulbId.toString())).resolves.toBeUndefined();
  });

  it('requires ADMIN to provide ulbId', async () => {
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });

    await expect(service.resolveEffectiveUlbId(user)).rejects.toThrow(BadRequestException);
  });

  it('rejects unsupported scopes', async () => {
    const user = makeUser({
      scope: 'DISTRICT' as Scope,
      accessLevel: AccessLevel.ADMIN,
    });

    await expect(service.resolveEffectiveUlbId(user, ulbId.toString())).rejects.toThrow(ForbiddenException);
    await expect(service.assertCanReadBankAccount(user, ulbId.toString())).rejects.toThrow(ForbiddenException);
    await expect(service.assertCanSubmitBankAccount(user, ulbId.toString())).rejects.toThrow(ForbiddenException);
  });

  it('allows STATE user reading a ULB in their own state', async () => {
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });
    ulbModel.findById.mockReturnValue(q({ state: stateId }));

    await expect(service.assertCanReadBankAccount(user, ulbId.toString())).resolves.toBeUndefined();
  });

  it('rejects STATE user reading a ULB in another state', async () => {
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });
    ulbModel.findById.mockReturnValue(q({ state: otherStateId }));

    await expect(service.assertCanReadBankAccount(user, ulbId.toString())).rejects.toThrow(ForbiddenException);
  });

  it('rejects STATE user submit', async () => {
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });

    await expect(service.assertCanSubmitBankAccount(user, ulbId.toString())).rejects.toThrow(ForbiddenException);
  });

  it('GET returns null when no record exists', async () => {
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    bankAccountModel.findOne.mockReturnValue(q(null));

    const result = await service.getBankAccount({ yearId: new Types.ObjectId().toString() }, user);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Bank account form fetched.');
    expect(result.data).toBeNull();
  });

  it('GET returns a safe mapped response when record exists', async () => {
    const yearId = new Types.ObjectId();
    const submittedBy = new Types.ObjectId();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    bankAccountModel.findOne.mockReturnValue(
      q({
        _id: new Types.ObjectId(),
        ulb: ulbId,
        designYear: yearId,
        ifscCode: 'SBIN0123456',
        bankDetails: {
          name: 'State Bank of India',
          branch: 'Main',
          address: 'MG Road',
          city: 'Bhopal',
          state: 'Madhya Pradesh',
          micr: null,
        },
        accountNumber: '123456789012',
        accountNumberEncrypted: 'encrypted-account-number',
        accountNumberHash: 'hashed-account-number',
        accountNumberMasked: '********9012',
        accountNumberLast4: '9012',
        proof: {
          fileName: 'proof.pdf',
          fileUrl: 's3://bucket/proof.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
        currentFormStatus: FORM_STATUS.IN_PROGRESS,
        submittedBy,
        submittedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      }),
    );

    const result = await service.getBankAccount({ yearId: yearId.toString() }, user);

    expect(result.data).toMatchObject({
      ulb: ulbId.toString(),
      designYear: yearId.toString(),
      ifscCode: 'SBIN0123456',
      accountNumberMasked: '********9012',
      accountNumberLast4: '9012',
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      currentFormStatusLabel: 'In Progress',
      submittedBy: submittedBy.toString(),
      submittedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      proof: {
        fileName: 'proof.pdf',
        fileUrl: 's3://bucket/proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      },
    });
  });

  it('GET does not expose encrypted, hash, or full account-number fields', async () => {
    const yearId = new Types.ObjectId();
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOne.mockReturnValue(
      q({
        _id: new Types.ObjectId(),
        ulb: ulbId,
        designYear: yearId,
        ifscCode: 'SBIN0123456',
        bankDetails: {},
        accountNumber: '123456789012',
        accountNumberEncrypted: 'encrypted-account-number',
        accountNumberHash: 'hashed-account-number',
        accountNumberMasked: '********9012',
        accountNumberLast4: '9012',
        proof: {},
        currentFormStatus: FORM_STATUS.IN_PROGRESS,
      }),
    );

    const result = await service.getBankAccount({ ulbId: ulbId.toString(), yearId: yearId.toString() }, user);

    expect(result.data).not.toHaveProperty('accountNumber');
    expect(result.data).not.toHaveProperty('accountNumberEncrypted');
    expect(result.data).not.toHaveProperty('accountNumberHash');
  });

  it('GET rejects a ULB user reading another ULB record', async () => {
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await expect(
      service.getBankAccount({ ulbId: otherUlbId.toString(), yearId: new Types.ObjectId().toString() }, user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('GET allows ADMIN to read requested ULB record', async () => {
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOne.mockReturnValue(q(null));

    await expect(
      service.getBankAccount({ ulbId: ulbId.toString(), yearId: new Types.ObjectId().toString() }, user),
    ).resolves.toMatchObject({ success: true, data: null });
  });

  it('GET allows STATE user to read a ULB in their own state', async () => {
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });
    ulbModel.findById.mockReturnValue(q({ state: stateId }));
    bankAccountModel.findOne.mockReturnValue(q(null));

    await expect(
      service.getBankAccount({ ulbId: ulbId.toString(), yearId: new Types.ObjectId().toString() }, user),
    ).resolves.toMatchObject({ success: true, data: null });
  });

  it('GET rejects STATE user reading a ULB in another state', async () => {
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });
    ulbModel.findById.mockReturnValue(q({ state: otherStateId }));

    await expect(
      service.getBankAccount({ ulbId: ulbId.toString(), yearId: new Types.ObjectId().toString() }, user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('POST submits a valid record successfully', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) =>
      q({
        _id: new Types.ObjectId(),
        ...update.$set,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const result = await service.submitBankAccount(dto, user);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Bank account form submitted.');
    expect(result.data).toMatchObject({
      ulb: ulbId.toString(),
      designYear: dto.designYearId,
      ifscCode: dto.ifscCode,
      accountNumberMasked: '********9012',
      accountNumberLast4: '9012',
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
      currentFormStatusLabel: 'Under Review by State',
      proof: dto.proof,
    });
  });

  it('POST throws a controlled error when BANK_ACCOUNT_ENCRYPTION_KEY is missing', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    delete process.env.BANK_ACCOUNT_ENCRYPTION_KEY;

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(
      'Bank account security configuration is invalid. Please contact support.',
    );
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST throws a controlled error when BANK_ACCOUNT_ENCRYPTION_KEY is invalid', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(16, 7).toString('base64');

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ServiceUnavailableException);
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST throws a controlled error when BANK_ACCOUNT_HASH_SECRET is missing', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    delete process.env.BANK_ACCOUNT_HASH_SECRET;

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ServiceUnavailableException);
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST throws a controlled error when authenticated user id is missing', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      _id: undefined as unknown as string,
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ForbiddenException);
    await expect(service.submitBankAccount(dto, user)).rejects.toThrow('Authenticated user id is missing or invalid.');
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST uses resolveEffectiveUlbId and assertCanSubmitBankAccount', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    const resolveSpy = jest.spyOn(service, 'resolveEffectiveUlbId');
    const submitScopeSpy = jest.spyOn(service, 'assertCanSubmitBankAccount');
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    expect(resolveSpy).toHaveBeenCalledWith(user, dto.ulbId);
    expect(submitScopeSpy).toHaveBeenCalledWith(user, dto.ulbId);
  });

  it('POST upserts by ulb and designYear and updates existing records', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);
    await service.submitBankAccount(dto, user);

    expect(bankAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    const [filter, , options] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      ulb: new Types.ObjectId(dto.ulbId),
      designYear: new Types.ObjectId(dto.designYearId),
    });
    expect(options).toMatchObject({ upsert: true, new: true, runValidators: true });
  });

  it('POST stores status, submit metadata, secure account fields, and SFC-style proof', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_STATE);
    expect(update.$set.submittedBy).toEqual(new Types.ObjectId(user._id));
    expect(update.$set.submittedAt).toBeInstanceOf(Date);
    expect(update.$set.accountNumberEncrypted).not.toBe(dto.accountNumber);
    expect(decryptAccountNumber(update.$set.accountNumberEncrypted)).toBe(dto.accountNumber);
    expect(update.$set.accountNumberHash).toEqual(expect.any(String));
    expect(update.$set.accountNumberHash).not.toBe(dto.accountNumber);
    expect(update.$set.accountNumberMasked).toBe('********9012');
    expect(update.$set.accountNumberLast4).toBe('9012');
    expect(update.$set).not.toHaveProperty('accountNumber');
    expect(update.$set).not.toHaveProperty('confirmAccountNumber');
    expect(update.$set.proof).toEqual({
      fileName: dto.proof.fileName,
      fileUrl: dto.proof.fileUrl,
      fileSize: dto.proof.fileSize,
      mimeType: dto.proof.mimeType,
    });
    expect(update.$set.proof).not.toHaveProperty('filepath');
    expect(update.$set.proof).not.toHaveProperty('originalName');
    expect(update.$set.proof).not.toHaveProperty('sizeKb');
  });

  it('POST accepts a clean proof.fileUrl from the signed-url flow', async () => {
    const dto = makeSubmitDto({
      proof: {
        fileName: 'proof.pdf',
        fileUrl: 'https://bucket.s3.amazonaws.com/xvi-fc/ulb/proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      },
    });
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proof.fileUrl).toBe(dto.proof.fileUrl);
    expect(update.$set.proof.fileUrl).not.toContain('?');
  });

  it('POST accepts bankDetails.micr as null', async () => {
    const dto = makeSubmitDto({ bankDetails: { ...makeSubmitDto().bankDetails, micr: null } });
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.bankDetails.micr).toBeNull();
  });

  it('POST response excludes encrypted, hash, full account number, and confirm account number', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) =>
      q({
        _id: new Types.ObjectId(),
        accountNumber: dto.accountNumber,
        confirmAccountNumber: dto.confirmAccountNumber,
        ...update.$set,
      }),
    );

    const result = await service.submitBankAccount(dto, user);

    expect(result.data).not.toHaveProperty('accountNumber');
    expect(result.data).not.toHaveProperty('confirmAccountNumber');
    expect(result.data).not.toHaveProperty('accountNumberEncrypted');
    expect(result.data).not.toHaveProperty('accountNumberHash');
  });

  it('POST rejects ULB_VIEWER submit', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ULB_VIEWER,
      scope: Scope.ULB,
      accessLevel: AccessLevel.VIEWER,
      ulb: ulbId,
    });

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ForbiddenException);
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST rejects STATE submit', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ForbiddenException);
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST allows ADMIN submit with requested ulbId', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await expect(service.submitBankAccount(dto, user)).resolves.toMatchObject({
      success: true,
      message: 'Bank account form submitted.',
    });
  });

  it('bank-account proof signed-url builds a scoped folder path', async () => {
    const yearId = new Types.ObjectId().toString();
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await service.getProofSignedUrl(
      {
        designYearId: yearId,
        fileName: 'proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      },
      user,
    );

    expect(s3UploadService.generatePutSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        folder: `xvi-fc/ulb/${ulbId.toString()}/${yearId}/bank-account/proof`,
      }),
    );
    const folder = s3UploadService.generatePutSignedUrl.mock.calls[0][0].folder as string;
    expect(folder.split('/')).toEqual([
      'xvi-fc',
      'ulb',
      ulbId.toString(),
      yearId,
      'bank-account',
      'proof',
    ]);
  });

  it.each(['application/pdf', 'image/jpeg', 'image/png'])(
    'bank-account proof signed-url accepts %s',
    async (mimeType) => {
      const user = makeUser({
        role: UserRole.ADMIN,
        scope: Scope.ADMIN,
        accessLevel: AccessLevel.ADMIN,
      });

      await expect(
        service.getProofSignedUrl(
          {
            ulbId: ulbId.toString(),
            designYearId: new Types.ObjectId().toString(),
            fileName: 'proof',
            fileSize: 1024,
            mimeType,
          },
          user,
        ),
      ).resolves.toMatchObject({ success: true });

      expect(s3UploadService.generatePutSignedUrl).toHaveBeenLastCalledWith(
        expect.objectContaining({ mimeType }),
      );
    },
  );

  it('bank-account proof signed-url rejects another ULB for ULB users', async () => {
    const user = makeUser({
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
    });

    await expect(
      service.getProofSignedUrl(
        {
          ulbId: otherUlbId.toString(),
          designYearId: new Types.ObjectId().toString(),
          fileName: 'proof.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(s3UploadService.generatePutSignedUrl).not.toHaveBeenCalled();
  });

  it('bank-account proof signed-url rejects STATE users', async () => {
    const user = makeUser({
      role: UserRole.STATE,
      scope: Scope.STATE,
      accessLevel: AccessLevel.ADMIN,
      state: stateId,
    });

    await expect(
      service.getProofSignedUrl(
        {
          ulbId: ulbId.toString(),
          designYearId: new Types.ObjectId().toString(),
          fileName: 'proof.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('bank-account proof signed-url allows ADMIN with requested ulbId', async () => {
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });

    await expect(
      service.getProofSignedUrl(
        {
          ulbId: ulbId.toString(),
          designYearId: new Types.ObjectId().toString(),
          fileName: 'proof.png',
          fileSize: 1024,
          mimeType: 'image/png',
        },
        user,
      ),
    ).resolves.toMatchObject({
      success: true,
      message: 'Bank account proof signed URL generated.',
    });
  });

  it('bank-account proof signed-url DTO allows only configured MIME types and max 5 MB', () => {
    expect(ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
    expect(MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);

    const invalidDto = plainToInstance(GetBankAccountProofSignedUrlDto, {
      ulbId: ulbId.toString(),
      designYearId: new Types.ObjectId().toString(),
      fileName: 'proof.gif',
      fileSize: MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES + 1,
      mimeType: 'image/gif',
    });

    const errors = validateSync(invalidDto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['fileSize', 'mimeType']));
  });

  it('valid IFSC lookup maps Razorpay response to bankDetails shape', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        BANK: 'Axis Bank',
        IFSC: 'UTIB0005157',
        BRANCH: 'Indore Main',
        ADDRESS: 'MG Road, Indore',
        CITY: 'Indore',
        STATE: 'Madhya Pradesh',
        MICR: '452211002',
      },
    });

    const result = await service.lookupIfsc('UTIB0005157');

    expect(axios.get).toHaveBeenCalledWith('https://ifsc.razorpay.com/UTIB0005157');
    expect(result).toEqual({
      success: true,
      message: 'IFSC details fetched.',
      data: {
        ifscCode: 'UTIB0005157',
        bankDetails: {
          name: 'Axis Bank',
          branch: 'Indore Main',
          address: 'MG Road, Indore',
          city: 'Indore',
          state: 'Madhya Pradesh',
          micr: '452211002',
        },
      },
      timestamp: expect.any(String),
    });
  });

  it('lowercase IFSC lookup is transformed to uppercase before calling Razorpay', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        BANK: 'Axis Bank',
        BRANCH: 'Indore Main',
        ADDRESS: 'MG Road, Indore',
        CITY: 'Indore',
        STATE: 'Madhya Pradesh',
        MICR: null,
      },
    });

    const result = await service.lookupIfsc(' utib0005157 ');

    expect(axios.get).toHaveBeenCalledWith('https://ifsc.razorpay.com/UTIB0005157');
    expect(result.data.ifscCode).toBe('UTIB0005157');
  });

  it('invalid IFSC lookup returns validation error', async () => {
    const axiosGetSpy = jest.spyOn(axios, 'get');

    await expect(service.lookupIfsc('UTIB1234567')).rejects.toThrow(BadRequestException);
    expect(axiosGetSpy).not.toHaveBeenCalled();
  });

  it('Razorpay no data returns a controlled not-found response', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });

    await expect(service.lookupIfsc('UTIB0005157')).rejects.toThrow(NotFoundException);
    await expect(service.lookupIfsc('UTIB0005157')).rejects.toThrow('No bank details found for this IFSC code.');
  });

  it('Razorpay 404 returns a controlled not-found response', async () => {
    const error = { isAxiosError: true, response: { status: 404 } };
    jest.spyOn(axios, 'get').mockRejectedValue(error);
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(service.lookupIfsc('UTIB0005157')).rejects.toThrow(NotFoundException);
    await expect(service.lookupIfsc('UTIB0005157')).rejects.toThrow('No bank details found for this IFSC code.');
  });

  it('external IFSC HTTP error is handled safely', async () => {
    const error = { isAxiosError: true, response: { status: 500 } };
    jest.spyOn(axios, 'get').mockRejectedValue(error);
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(service.lookupIfsc('UTIB0005157')).rejects.toThrow(ServiceUnavailableException);
    await expect(service.lookupIfsc('UTIB0005157')).rejects.toThrow('Unable to fetch IFSC details. Please try again.');
  });
});

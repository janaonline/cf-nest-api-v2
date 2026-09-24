import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { BankAccountService } from './bank-account.service';
import type { SubmitXviFcBankAccountDto } from './dto/submit-xvi-fc-bank-account.dto';
import { decryptAccountNumber } from './utils/bank-account-security.util';

function q<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('BankAccountService scope enforcement', () => {
  let service: BankAccountService;
  let bankAccountModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let formLogModel: { create: jest.Mock };
  let ulbModel: { findById: jest.Mock; aggregate: jest.Mock };
  let userModel: { findById: jest.Mock };
  let yearModel: { findById: jest.Mock };
  let fileTokenService: { signFileUrl: jest.Mock };
  let ulbEligibilityService: { assertUlbEligibleForGrantCycle: jest.Mock };
  let formJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let formJsonConfigService: { findByFormId: jest.Mock };
  let formReturnedNotification: { notifyReturned: jest.Mock };
  const originalEncryptionKey = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  const originalHashSecret = process.env.BANK_ACCOUNT_HASH_SECRET;

  const ulbId = new Types.ObjectId();
  const otherUlbId = new Types.ObjectId();
  const stateId = new Types.ObjectId();
  const otherStateId = new Types.ObjectId();
  const validSha256 = 'a'.repeat(64);

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

  const makeSubmitDto = (overrides: Partial<SubmitXviFcBankAccountDto> = {}): SubmitXviFcBankAccountDto => {
    const dtoUlbId = overrides.ulbId ?? ulbId.toString();
    const designYearId = overrides.designYearId ?? new Types.ObjectId().toString();

    return {
      ulbId: dtoUlbId,
      stateId: stateId.toString(),
      designYearId,
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
      proofFile: {
        originalName: 'proof.pdf',
        mimeType: 'application/pdf',
        pages: 2,
        sizeKb: 1,
        s3Key: `xvi-fc/bank-account/${dtoUlbId}/${designYearId}/proof/proof.pdf`,
        sha256: validSha256,
      },
      ...overrides,
    } as SubmitXviFcBankAccountDto;
  };

  beforeEach(() => {
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.BANK_ACCOUNT_HASH_SECRET = 'test-bank-account-hash-secret';

    bankAccountModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    formLogModel = {
      create: jest.fn().mockResolvedValue({}),
    };
    ulbModel = {
      findById: jest.fn().mockReturnValue(q({ state: stateId })),
      aggregate: jest.fn(),
    };
    userModel = {
      findById: jest.fn().mockReturnValue(q({ name: 'Test Decider' })),
    };
    yearModel = {
      findById: jest.fn().mockReturnValue(q({ year: '2027-28' })),
    };
    fileTokenService = {
      signFileUrl: jest.fn((path: string) => `https://signed-url.example.com/${path}`),
    };
    ulbEligibilityService = {
      assertUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(undefined),
    };
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn(),
    };
    // Default: PER_YEAR (or unconfigured) - existing (pre-dynamic-year-access) behavior unchanged.
    formJsonConfigService = {
      findByFormId: jest.fn().mockResolvedValue(null),
    };
    formReturnedNotification = {
      notifyReturned: jest.fn().mockResolvedValue(undefined),
    };
    service = new BankAccountService(
      bankAccountModel as never,
      formLogModel as never,
      ulbModel as never,
      userModel as never,
      yearModel as never,
      fileTokenService as never,
      ulbEligibilityService as never,
      formJsonService as never,
      formJsonConfigService as never,
      formReturnedNotification as never,
    );

    // Default Razorpay IFSC lookup used by submitBankAccount()'s verifyIfscCode() — matches
    // makeSubmitDto()'s default bankDetails so existing submit tests pass verification unchanged.
    // lookupIfsc()-specific tests below override this with their own jest.spyOn(axios, 'get').
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        BANK: 'State Bank of India',
        BRANCH: 'Main',
        ADDRESS: 'MG Road',
        CITY: 'Bhopal',
        STATE: 'Madhya Pradesh',
        MICR: null,
      },
    });
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
        proofFile: {
          originalName: 'proof.pdf',
          mimeType: 'application/pdf',
          pages: 2,
          sizeKb: 1,
          s3Key: `xvi-fc/bank-account/${ulbId.toString()}/${yearId.toString()}/proof/proof.pdf`,
          sha256: validSha256,
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
      proofFile: {
        originalName: 'proof.pdf',
        mimeType: 'application/pdf',
        pages: 2,
        sizeKb: 1,
        s3Key: `xvi-fc/bank-account/${ulbId.toString()}/${yearId.toString()}/proof/proof.pdf`,
        sha256: validSha256,
      },
    });
    expect(result.data).not.toHaveProperty('proof');
  });

  describe('GET - xvi-fc dynamic year access (ONCE_EVER submission scope)', () => {
    it('queries by ulb + designYear (unchanged) when submissionScope is PER_YEAR or unconfigured', async () => {
      const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });
      const requestedYearId = new Types.ObjectId();
      bankAccountModel.findOne.mockReturnValue(q(null));

      await service.getBankAccount({ yearId: requestedYearId.toString() }, user);

      const [filter] = bankAccountModel.findOne.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toHaveProperty('designYear');
    });

    it('queries by ulb alone, ignoring the requested year, when submissionScope is ONCE_EVER', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });
      const requestedYearId = new Types.ObjectId();
      bankAccountModel.findOne.mockReturnValue(q(null));

      await service.getBankAccount({ yearId: requestedYearId.toString() }, user);

      const [filter] = bankAccountModel.findOne.mock.calls[0] as [Record<string, unknown>];
      expect(filter).not.toHaveProperty('designYear');
      expect((filter['ulb'] as Types.ObjectId).toString()).toBe(ulbId.toString());
    });

    it('returns the record from its original year even when a different year is requested (ONCE_EVER)', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      const originalYearId = new Types.ObjectId();
      const requestedYearId = new Types.ObjectId(); // different from originalYearId
      const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });
      bankAccountModel.findOne.mockReturnValue(
        q({
          _id: new Types.ObjectId(),
          ulb: ulbId,
          designYear: originalYearId, // record belongs to its original submission year
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          proofFile: { originalName: 'proof.pdf', mimeType: 'application/pdf', pages: 2, sizeKb: 1, s3Key: 'k', sha256: validSha256 },
        }),
      );

      yearModel.findById.mockReturnValue(q({ year: '2026-27' }));

      const result = await service.getBankAccount({ yearId: requestedYearId.toString() }, user);

      // designYear in the response is the record's true year, not the requested one - the
      // frontend uses this mismatch to redirect the ULB to where the record actually lives.
      expect((result.data as { designYear: string }).designYear).toBe(originalYearId.toString());
      expect((result.data as { designYearLabel: string | null }).designYearLabel).toBe('2026-27');
      expect(yearModel.findById).toHaveBeenCalledWith(originalYearId, { year: 1 });
    });

    it('leaves designYearLabel null when the requested year already matches the record (ONCE_EVER)', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      const yearId = new Types.ObjectId();
      const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });
      bankAccountModel.findOne.mockReturnValue(
        q({
          _id: new Types.ObjectId(),
          ulb: ulbId,
          designYear: yearId,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          proofFile: { originalName: 'proof.pdf', mimeType: 'application/pdf', pages: 2, sizeKb: 1, s3Key: 'k', sha256: validSha256 },
        }),
      );

      const result = await service.getBankAccount({ yearId: yearId.toString() }, user);

      expect((result.data as { designYearLabel: string | null }).designYearLabel).toBeNull();
      expect(yearModel.findById).not.toHaveBeenCalled();
    });

    it('includes submissionScope in the response so the frontend does not have to hardcode it', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });
      bankAccountModel.findOne.mockReturnValue(
        q({
          _id: new Types.ObjectId(),
          ulb: ulbId,
          designYear: new Types.ObjectId(),
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          proofFile: { originalName: 'proof.pdf', mimeType: 'application/pdf', pages: 2, sizeKb: 1, s3Key: 'k', sha256: validSha256 },
        }),
      );

      const result = await service.getBankAccount({ yearId: new Types.ObjectId().toString() }, user);

      expect((result.data as { submissionScope: string }).submissionScope).toBe('ONCE_EVER');
    });
  });

  describe('submitBankAccount - xvi-fc dynamic year access (ONCE_EVER submission scope)', () => {
    it('blocks a second submission for a different design year when submissionScope is ONCE_EVER', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      const existingYearId = new Types.ObjectId();
      bankAccountModel.findOne.mockReturnValue(q({ designYear: existingYearId }));
      const dto = makeSubmitDto({ designYearId: new Types.ObjectId().toString() });
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ConflictException);
      expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('allows resubmission for the same design year when submissionScope is ONCE_EVER', async () => {
      const dto = makeSubmitDto();
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      bankAccountModel.findOne.mockReturnValue(q({ designYear: new Types.ObjectId(dto.designYearId) }));
      bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await service.submitBankAccount(dto, user);

      expect(bankAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('allows submission when no prior record exists yet, even if submissionScope is ONCE_EVER', async () => {
      const dto = makeSubmitDto();
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      bankAccountModel.findOne.mockReturnValue(q(null));
      bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await service.submitBankAccount(dto, user);

      expect(bankAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('never checks for a cross-year record when submissionScope is PER_YEAR or unconfigured', async () => {
      const dto = makeSubmitDto();
      // formJsonConfigService default mock resolves null (PER_YEAR/unconfigured) - see beforeEach.
      bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await service.submitBankAccount(dto, user);

      expect(bankAccountModel.findOne).not.toHaveBeenCalled();
      expect(bankAccountModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('denormalizes submissionScope onto the upserted document, for the {ulb} partial unique index to key off', async () => {
      const dto = makeSubmitDto();
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      bankAccountModel.findOne.mockReturnValue(q(null));
      bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await service.submitBankAccount(dto, user);

      const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.submissionScope).toBe('ONCE_EVER');
    });

    it('translates a duplicate-key error (E11000) from the {ulb} partial unique index into the same ConflictException the preflight check throws', async () => {
      const dto = makeSubmitDto();
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      // Preflight check sees no record yet (the race: another request's insert commits in between).
      const existingYearId = new Types.ObjectId();
      bankAccountModel.findOne
        .mockReturnValueOnce(q(null)) // assertNoCrossYearBankAccountRecord's preflight
        .mockReturnValueOnce(q({ designYear: existingYearId })); // the catch block's re-lookup
      bankAccountModel.findOneAndUpdate.mockImplementation(() => ({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 })),
      }));
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ConflictException);
    });

    it('rethrows a non-duplicate-key error from the upsert unchanged', async () => {
      const dto = makeSubmitDto();
      bankAccountModel.findOneAndUpdate.mockImplementation(() => ({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('connection reset')),
      }));
      const user = makeUser({ role: UserRole.ADMIN, scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN });

      await expect(service.submitBankAccount(dto, user)).rejects.toThrow('connection reset');
    });
  });

  describe('listUlbBankAccounts - xvi-fc dynamic year access (ONCE_EVER submission scope)', () => {
    const stateReviewer = (state: Types.ObjectId): AuthUser =>
      ({
        _id: new Types.ObjectId().toString(),
        scope: Scope.STATE,
        state,
        xviFcSubrole: 'reviewer',
      }) as unknown as AuthUser;

    const baseDto = { designYearId: new Types.ObjectId().toString(), page: 1, pageSize: 20 } as never;

    function lastPipeline(): Array<Record<string, unknown>> {
      return ulbModel.aggregate.mock.calls[ulbModel.aggregate.mock.calls.length - 1][0];
    }

    it('joins by ulb alone (no designYear clause) when submissionScope is ONCE_EVER, so a record filed in an earlier year still resolves', async () => {
      formJsonConfigService.findByFormId.mockResolvedValue({ formId: 33, submissionScope: 'ONCE_EVER' });
      ulbModel.aggregate.mockReturnValue(q([{ data: [], totalCount: [], counts: [] }]));

      await service.listUlbBankAccounts(baseDto, stateReviewer(stateId));

      const lookupStage = lastPipeline().find((stage) => '$lookup' in stage) as {
        $lookup: { pipeline: Array<{ $match: { $expr: unknown } } >} ;
      };
      expect(lookupStage.$lookup.pipeline[0].$match.$expr).toEqual({ $eq: ['$ulb', '$$ulbId'] });
    });

    it('still joins by ulb + designYear when submissionScope is PER_YEAR or unconfigured', async () => {
      // formJsonConfigService default mock resolves null (PER_YEAR/unconfigured) - see beforeEach.
      ulbModel.aggregate.mockReturnValue(q([{ data: [], totalCount: [], counts: [] }]));

      await service.listUlbBankAccounts(baseDto, stateReviewer(stateId));

      const lookupStage = lastPipeline().find((stage) => '$lookup' in stage) as {
        $lookup: { pipeline: Array<{ $match: { $expr: unknown } }> };
      };
      expect(lookupStage.$lookup.pipeline[0].$match.$expr).toEqual({
        $and: [{ $eq: ['$ulb', '$$ulbId'] }, { $eq: ['$designYear', new Types.ObjectId(baseDto.designYearId)] }],
      });
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
        proofFile: {
          originalName: 'proof.pdf',
          mimeType: 'application/pdf',
          pages: 1,
          sizeKb: 1,
          s3Key: `xvi-fc/bank-account/${ulbId.toString()}/${yearId.toString()}/proof/proof.pdf`,
          sha256: validSha256,
        },
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
      proofFile: dto.proofFile,
    });
    expect(result.data).not.toHaveProperty('proof');
  });

  it('POST rejects bankDetails that do not match the verified IFSC record', async () => {
    const dto = makeSubmitDto({ bankDetails: { ...makeSubmitDto().bankDetails, name: 'Fabricated Bank' } });
    const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(BadRequestException);
    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(
      'bankDetails.name does not match the verified IFSC details.',
    );
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST rejects an IFSC code that Razorpay does not recognize', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const dto = makeSubmitDto();
    const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(BadRequestException);
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('POST fails closed when the Razorpay IFSC lookup is unreachable', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('network error'));
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
    const dto = makeSubmitDto();
    const user = makeUser({ role: UserRole.ULB, scope: Scope.ULB, accessLevel: AccessLevel.ADMIN, ulb: ulbId });

    await expect(service.submitBankAccount(dto, user)).rejects.toThrow(ServiceUnavailableException);
    expect(bankAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
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

  it('POST stores status, submit metadata, secure account fields, and proofFile only', async () => {
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
    expect(update.$set).not.toHaveProperty('proof');
    expect(update.$set.proofFile).toEqual({
      originalName: dto.proofFile.originalName,
      mimeType: dto.proofFile.mimeType,
      pages: dto.proofFile.pages,
      sizeKb: dto.proofFile.sizeKb,
      s3Key: dto.proofFile.s3Key,
      sha256: dto.proofFile.sha256,
    });
  });

  it('POST accepts a proofFile.s3Key path and stores it unchanged', async () => {
    const dto = makeSubmitDto();
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proofFile.s3Key).toBe(dto.proofFile.s3Key);
  });

  it('POST converts a full S3 proofFile.s3Key URL to an object key', async () => {
    const dto = makeSubmitDto();
    const path = dto.proofFile.s3Key;
    dto.proofFile = {
      ...dto.proofFile,
      s3Key: `https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/${path}`,
    };
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proofFile.s3Key).toBe(path);
    expect(update.$set.proofFile.s3Key).not.toMatch(/^https?:\/\//);
  });

  it('POST strips query params from a signed proofFile.s3Key URL before storing', async () => {
    const dto = makeSubmitDto();
    const path = dto.proofFile.s3Key;
    dto.proofFile = {
      ...dto.proofFile,
      s3Key: `https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=secret`,
    };
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proofFile.s3Key).toBe(path);
    expect(update.$set.proofFile.s3Key).not.toContain('?');
  });

  it('POST converts an s3:// proofFile.s3Key URL to an object key', async () => {
    const dto = makeSubmitDto();
    const path = dto.proofFile.s3Key;
    dto.proofFile = {
      ...dto.proofFile,
      s3Key: `s3://jana-cityfinance-stg/${path}?temporary=true`,
    };
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proofFile.s3Key).toBe(path);
  });

  it('POST stores PDF pages value', async () => {
    const dto = makeSubmitDto();
    dto.proofFile = { ...dto.proofFile, mimeType: 'application/pdf', pages: 6 };
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proofFile.pages).toBe(6);
  });

  it('POST stores image pages as null', async () => {
    const dto = makeSubmitDto();
    dto.proofFile = { ...dto.proofFile, originalName: 'proof.png', mimeType: 'image/png', pages: 3 };
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    await service.submitBankAccount(dto, user);

    const [, update] = bankAccountModel.findOneAndUpdate.mock.calls[0];
    expect(update.$set.proofFile.pages).toBeNull();
  });

  it('POST response returns proofFile.s3Key as the stored object key', async () => {
    const dto = makeSubmitDto();
    const path = dto.proofFile.s3Key;
    dto.proofFile = {
      ...dto.proofFile,
      s3Key: `https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    };
    const user = makeUser({
      role: UserRole.ADMIN,
      scope: Scope.ADMIN,
      accessLevel: AccessLevel.ADMIN,
    });
    bankAccountModel.findOneAndUpdate.mockImplementation((_filter, update) => q({ _id: new Types.ObjectId(), ...update.$set }));

    const result = await service.submitBankAccount(dto, user);

    expect(result.data.proofFile.s3Key).toBe(path);
    expect(result.data).not.toHaveProperty('proof');
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

  describe('getFormConfig', () => {
    it('fetches the formId-33 formJson for the given year and returns its meta/data', async () => {
      formJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({
        meta: { title: 'Bank Account' },
        data: [{ key: 'ifscCode', formFieldType: 'text', label: 'IFSC Code' }],
      });

      const result = await service.getFormConfig('year-1');

      expect(formJsonService.findActiveByDesignYearAndFormId).toHaveBeenCalledWith('year-1', 33);
      expect(result).toEqual({
        meta: { title: 'Bank Account' },
        data: [{ key: 'ifscCode', formFieldType: 'text', label: 'IFSC Code' }],
      });
    });

    it('defaults meta/data to empty when the formJson document has neither set', async () => {
      formJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({});

      const result = await service.getFormConfig('year-1');

      expect(result).toEqual({ meta: {}, data: [] });
    });
  });
});

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from '../../../auth/enum/roles-xvi-fc.enum';
import { UnspentBalanceDisclosureService } from './unspent-balance-disclosure.service';
import type { SubmitDisclosureDto } from './dto/submit-disclosure.dto';
import type { UpdateDisclosureDto } from './dto/update-disclosure.dto';

function q<T>(value: T) {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

describe('UnspentBalanceDisclosureService', () => {
  let service: UnspentBalanceDisclosureService;
  let model: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; findById: jest.Mock; findByIdAndUpdate: jest.Mock };
  let s3: { presignGet: jest.Mock };

  const ulbId = new Types.ObjectId();
  const otherUlbId = new Types.ObjectId();
  const designYearId = new Types.ObjectId();

  const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser =>
    ({
      _id: new Types.ObjectId().toString(),
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
      state: null,
      ...overrides,
    }) as AuthUser;

  const makeFcPeriod = () => ({
    manual: {
      bankAccounts: [
        {
          accountNumber: '123456789012',
          unspentBalance: 1000,
          documents: [{ filepath: 'a.pdf', originalName: 'a.pdf', mimeType: 'application/pdf' }],
        },
      ],
    },
  });

  const makeSubmitDto = (overrides: Partial<SubmitDisclosureDto> = {}): SubmitDisclosureDto =>
    ({
      designYearId: designYearId.toString(),
      fc14: makeFcPeriod(),
      fc15: makeFcPeriod(),
      ...overrides,
    }) as SubmitDisclosureDto;

  beforeEach(() => {
    model = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    s3 = { presignGet: jest.fn().mockResolvedValue('https://signed.example/doc.pdf') };
    service = new UnspentBalanceDisclosureService(model as never, s3 as never);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── submit ───────────────────────────────────────────────────────────────

  describe('submit', () => {
    it('throws ForbiddenException when the user has no ULB context', async () => {
      const user = makeUser({ ulb: null });

      await expect(service.submit(makeSubmitDto(), user)).rejects.toThrow(ForbiddenException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a disclosure is already SUBMITTED', async () => {
      const user = makeUser();
      model.findOne.mockReturnValue(q({ formStatus: 'SUBMITTED' }));

      await expect(service.submit(makeSubmitDto(), user)).rejects.toThrow(ConflictException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('upserts and returns the disclosure on first submission', async () => {
      const user = makeUser();
      const dto = makeSubmitDto();
      model.findOne.mockReturnValue(q(null));
      model.findOneAndUpdate.mockResolvedValue({ _id: new Types.ObjectId(), formStatus: 'SUBMITTED' });

      const result = await service.submit(dto, user);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { ulb: ulbId, designYear: designYearId },
        {
          $set: expect.objectContaining({
            ulb: ulbId,
            designYear: designYearId,
            formStatus: 'SUBMITTED',
            submittedBy: new Types.ObjectId(user._id),
          }),
        },
        { upsert: true, new: true, runValidators: true },
      );
      expect(result).toMatchObject({ formStatus: 'SUBMITTED' });
    });

    it('allows re-submission (upsert) when the existing disclosure is still DRAFT', async () => {
      const user = makeUser();
      model.findOne.mockReturnValue(q({ formStatus: 'DRAFT' }));
      model.findOneAndUpdate.mockResolvedValue({ _id: new Types.ObjectId(), formStatus: 'SUBMITTED' });

      await expect(service.submit(makeSubmitDto(), user)).resolves.toMatchObject({ formStatus: 'SUBMITTED' });
    });
  });

  // ─── getByUlbAndYear ──────────────────────────────────────────────────────

  describe('getByUlbAndYear', () => {
    it('queries by ulb and designYear and returns the document', async () => {
      const doc = { _id: new Types.ObjectId(), formStatus: 'DRAFT' };
      model.findOne.mockResolvedValue(doc);

      const result = await service.getByUlbAndYear(ulbId.toString(), designYearId.toString());

      expect(model.findOne).toHaveBeenCalledWith({ ulb: ulbId, designYear: designYearId });
      expect(result).toBe(doc);
    });

    it('returns null when no disclosure exists', async () => {
      model.findOne.mockResolvedValue(null);

      const result = await service.getByUlbAndYear(ulbId.toString(), designYearId.toString());

      expect(result).toBeNull();
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when the disclosure does not exist', async () => {
      model.findById.mockResolvedValue(null);

      await expect(service.update('missing-id', {} as UpdateDisclosureDto, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the disclosure belongs to another ULB', async () => {
      model.findById.mockResolvedValue({ ulb: otherUlbId, formStatus: 'DRAFT' });

      await expect(service.update('id-1', {} as UpdateDisclosureDto, makeUser())).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the disclosure has already been submitted', async () => {
      model.findById.mockResolvedValue({ ulb: ulbId, formStatus: 'SUBMITTED' });

      await expect(service.update('id-1', {} as UpdateDisclosureDto, makeUser())).rejects.toThrow(ForbiddenException);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('updates only the provided fc14/fc15 fields', async () => {
      model.findById.mockResolvedValue({ ulb: ulbId, formStatus: 'DRAFT' });
      const updated = { _id: 'id-1', formStatus: 'DRAFT', fc14: makeFcPeriod() };
      model.findByIdAndUpdate.mockResolvedValue(updated);
      const dto = { fc14: makeFcPeriod() } as UpdateDisclosureDto;

      const result = await service.update('id-1', dto, makeUser());

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        'id-1',
        { $set: { fc14: dto.fc14 } },
        { new: true, runValidators: true },
      );
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when the record disappears between the read and the update', async () => {
      model.findById.mockResolvedValue({ ulb: ulbId, formStatus: 'DRAFT' });
      model.findByIdAndUpdate.mockResolvedValue(null);

      await expect(service.update('id-1', {} as UpdateDisclosureDto, makeUser())).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getDocumentSignedUrl ─────────────────────────────────────────────────

  describe('getDocumentSignedUrl', () => {
    const filepath = 'a.pdf';

    it('throws NotFoundException when the disclosure does not exist', async () => {
      model.findById.mockReturnValue(q(null));

      await expect(service.getDocumentSignedUrl('id-1', filepath, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the disclosure belongs to another ULB', async () => {
      model.findById.mockReturnValue(q({ ulb: otherUlbId, fc14: makeFcPeriod(), fc15: makeFcPeriod() }));

      await expect(service.getDocumentSignedUrl('id-1', filepath, makeUser())).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the filepath does not belong to this disclosure', async () => {
      model.findById.mockReturnValue(q({ ulb: ulbId, fc14: makeFcPeriod(), fc15: makeFcPeriod() }));

      await expect(service.getDocumentSignedUrl('id-1', 'someone-elses-file.pdf', makeUser())).rejects.toThrow(
        ForbiddenException,
      );
      expect(s3.presignGet).not.toHaveBeenCalled();
    });

    it('returns a presigned URL when the filepath belongs to fc14', async () => {
      model.findById.mockReturnValue(q({ ulb: ulbId, fc14: makeFcPeriod(), fc15: { manual: { bankAccounts: [] } } }));

      const result = await service.getDocumentSignedUrl('id-1', filepath, makeUser());

      expect(s3.presignGet).toHaveBeenCalledWith(filepath);
      expect(result).toEqual({ signedUrl: 'https://signed.example/doc.pdf' });
    });

    it('returns a presigned URL when the filepath belongs to fc15', async () => {
      model.findById.mockReturnValue(
        q({ ulb: ulbId, fc14: { manual: { bankAccounts: [] } }, fc15: makeFcPeriod() }),
      );

      const result = await service.getDocumentSignedUrl('id-1', filepath, makeUser());

      expect(s3.presignGet).toHaveBeenCalledWith(filepath);
      expect(result).toEqual({ signedUrl: 'https://signed.example/doc.pdf' });
    });
  });
});

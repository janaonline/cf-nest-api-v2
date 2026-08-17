import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { BudgetDocumentService } from './budget-document.service';
import type { UploadBudgetDocumentDto } from './dto/upload-budget-document.dto';

function q<T>(value: T) {
  return { lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('BudgetDocumentService', () => {
  let service: BudgetDocumentService;
  let model: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let yearModel: { findById: jest.Mock };
  let ulbEligibilityService: { assertUlbEligibleForGrantCycle: jest.Mock };
  let fileTokenService: { signFileUrl: jest.Mock };

  const ulbId = new Types.ObjectId();
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

  const makeUploadDto = (overrides: Partial<UploadBudgetDocumentDto> = {}): UploadBudgetDocumentDto =>
    ({
      designYearId: designYearId.toString(),
      originalName: 'Budget-2026-27.pdf',
      sizeKb: 512,
      s3Key: 'budgets/2026-27/Budget-2026-27_abc123.pdf',
      ...overrides,
    }) as UploadBudgetDocumentDto;

  beforeEach(() => {
    model = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
    yearModel = { findById: jest.fn().mockReturnValue(q({ year: '2026-27' })) };
    ulbEligibilityService = { assertUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(undefined) };
    fileTokenService = { signFileUrl: jest.fn().mockReturnValue('https://signed.example/budget.pdf') };
    service = new BudgetDocumentService(
      model as never,
      yearModel as never,
      ulbEligibilityService as never,
      fileTokenService as never,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getByUlbAndYear ──────────────────────────────────────────────────────

  describe('getByUlbAndYear', () => {
    it('throws ForbiddenException for a non-ULB scope', async () => {
      const user = makeUser({ scope: Scope.STATE });
      await expect(service.getByUlbAndYear(user, designYearId.toString())).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the ULB user has no ulb mapped', async () => {
      const user = makeUser({ ulb: null });
      await expect(service.getByUlbAndYear(user, designYearId.toString())).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the design year does not exist', async () => {
      yearModel.findById.mockReturnValue(q(null));
      await expect(service.getByUlbAndYear(makeUser(), designYearId.toString())).rejects.toThrow(NotFoundException);
    });

    it('returns file: null when no yearsData entry exists for this year', async () => {
      model.findOne.mockReturnValue(q(null));

      const result = await service.getByUlbAndYear(makeUser(), designYearId.toString());

      expect(result.data).toEqual({ designYearId: designYearId.toString(), designYear: '2026-27', file: null });
    });

    it("returns file: null when the only file present is 'cfr'-sourced", async () => {
      model.findOne.mockReturnValue(
        q({ yearsData: [{ files: [{ source: 'cfr', name: 'old.pdf', url: '/x.pdf', createdAt: new Date() }] }] }),
      );

      const result = await service.getByUlbAndYear(makeUser(), designYearId.toString());

      expect(result.data.file).toBeNull();
    });

    it("returns the signed inline url when a 'ulb'-sourced file is present", async () => {
      const createdAt = new Date('2026-01-01');
      model.findOne.mockReturnValue(
        q({
          yearsData: [
            {
              files: [
                { source: 'cfr', name: 'old.pdf', url: '/old.pdf', createdAt },
                { source: 'ulb', name: 'Budget.pdf', url: '/budgets/2026-27/Budget.pdf', createdAt },
              ],
            },
          ],
        }),
      );

      const result = await service.getByUlbAndYear(makeUser(), designYearId.toString());

      expect(fileTokenService.signFileUrl).toHaveBeenCalledWith('/budgets/2026-27/Budget.pdf', 'inline');
      expect(result.data.file).toEqual({
        name: 'Budget.pdf',
        uploadedAt: createdAt,
        url: 'https://signed.example/budget.pdf',
      });
    });
  });

  // ─── upload ───────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('rejects when the ULB is ineligible for the grant cycle', async () => {
      ulbEligibilityService.assertUlbEligibleForGrantCycle.mockRejectedValue(new ForbiddenException('ineligible'));

      await expect(service.upload(makeUploadDto(), makeUser())).rejects.toThrow(ForbiddenException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a VIEWER access level', async () => {
      const user = makeUser({ accessLevel: AccessLevel.VIEWER });
      await expect(service.upload(makeUploadDto(), user)).rejects.toThrow(ForbiddenException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when s3Key doesn't match the resolved design year folder", async () => {
      const dto = makeUploadDto({ s3Key: 'budgets/2025-26/Budget.pdf' }); // resolved year is 2026-27
      await expect(service.upload(dto, makeUser())).rejects.toThrow(BadRequestException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('pushes a new yearsData entry with upsert when no entry exists yet for this year', async () => {
      model.findOne.mockReturnValue(q(null));
      model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.upload(makeUploadDto(), makeUser());

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { ulb: ulbId, 'yearsData.designYearId': { $ne: designYearId } },
        expect.objectContaining({
          $setOnInsert: { ulb: ulbId },
          $push: {
            yearsData: expect.objectContaining({
              designYearId,
              designYear: '2026-27',
              sequence: 12, // (2026 - 2014)
              files: [expect.objectContaining({ source: 'ulb', name: 'Budget-2026-27.pdf' })],
            }),
          },
        }),
        expect.objectContaining({ upsert: true }),
      );
    });

    it("replaces only the 'ulb'-sourced file, preserving a coexisting 'cfr' file", async () => {
      const cfrFile = { source: 'cfr', name: 'legacy.pdf', url: '/legacy.pdf', createdAt: new Date() };
      model.findOne.mockReturnValue(q({ yearsData: [{ files: [cfrFile] }] }));
      model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.upload(makeUploadDto(), makeUser());

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { ulb: ulbId, 'yearsData.designYearId': designYearId },
        {
          $set: {
            'yearsData.$.files': [expect.objectContaining({ source: 'ulb' }), cfrFile],
            'yearsData.$.designYear': '2026-27',
          },
        },
        expect.objectContaining({ runValidators: true }),
      );
    });

    it("discards a prior 'ulb'-sourced file entirely on re-upload", async () => {
      const oldUlbFile = { source: 'ulb', name: 'old-budget.pdf', url: '/old.pdf', createdAt: new Date() };
      model.findOne.mockReturnValue(q({ yearsData: [{ files: [oldUlbFile] }] }));
      model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.upload(makeUploadDto(), makeUser());

      const [, update] = model.findOneAndUpdate.mock.calls[0];
      expect(update.$set['yearsData.$.files']).toHaveLength(1);
      expect(update.$set['yearsData.$.files']).not.toContainEqual(oldUlbFile);
    });

    it('retries once as a plain update after losing an insert race (duplicate key error)', async () => {
      model.findOne.mockReturnValue(q(null));
      const dupError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      model.findOneAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockRejectedValueOnce(dupError) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValueOnce({}) });

      await expect(service.upload(makeUploadDto(), makeUser())).resolves.toBeDefined();
      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('rethrows a non-duplicate-key error without retrying', async () => {
      model.findOne.mockReturnValue(q(null));
      const otherError = new Error('some other db error');
      model.findOneAndUpdate.mockReturnValueOnce({ exec: jest.fn().mockRejectedValueOnce(otherError) });

      await expect(service.upload(makeUploadDto(), makeUser())).rejects.toThrow('some other db error');
      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });
});

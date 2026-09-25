import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SfcStatusService } from './sfc-status.service';
import { XviFcSfcStatus } from '../../../../schemas/xvi-fc/state/sfc-status.schema';
import { XviFcSfcStatusHistory } from '../../../../schemas/xvi-fc/state/sfc-status-history.schema';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { DynamicFormValidationService } from '../../common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from '../../common/services/xvifc-form-actors.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FileUrlNormalizerService } from '../../common/services/file-url-normalizer.service';
import { FileInfoNormalizerService } from '../../common/services/file-info-normalizer.service';
import { ExemptionResolverService } from '../../common/services/exemption-resolver.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { XviFcValidationErrorMap } from '../../common/response/xvi-fc-api-response';
import type { SaveSfcStatusDto } from './dto/save-sfc-status.dto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'populate', 'exec']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  chain['then'] = (ful: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(ful, rej);
  chain['catch'] = (rej: (e: unknown) => unknown) => Promise.resolve(value).catch(rej);
  chain['finally'] = (fin: () => void) => Promise.resolve(value).finally(fin);
  return chain;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId('67d7d136d3d038946a5239e9'); // 2026-27
const docOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  scope: Scope.ADMIN,
  state: null,
} as unknown as AuthUser;

// adminUser above has no `role`, so getEffectivePermissions gives it none of the edit/final-submit
// permissions buildStateFormPermissions checks for - fine for tests that only exercise
// assertStateAccess, but useless for asserting a *real* canEdit/canFinalSubmit:true baseline.
// This one has role: UserRole.ADMIN, which does grant every Permission.
const fullyPermissionedAdminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  state: null,
} as unknown as AuthUser;

const stateUser = (state: Types.ObjectId): AuthUser =>
  ({
    _id: new Types.ObjectId().toString(),
    scope: Scope.STATE,
    state,
  }) as unknown as AuthUser;

const mockFormDoc = {
  _id: docOid,
  state: stateOid,
  year: yearOid,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  data: {},
  toObject: () => ({
    _id: docOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.IN_PROGRESS,
    data: {},
  }),
};

const mockFormQuestions = [{ key: 'sfcStatus', formFieldType: 'radio', label: 'SFC Status', value: '' }];

const validDto: SaveSfcStatusDto = {
  stateId: stateOid.toString(),
  yearId: yearOid.toString(),
  data: { sfcStatus: 'active' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SfcStatusService', () => {
  let service: SfcStatusService;
  let formModel: Record<string, jest.Mock>;
  let historyModel: Record<string, jest.Mock>;
  let formJsonService: Partial<FormJsonService>;
  let validator: Partial<DynamicFormValidationService>;
  let mockExemptionResolverService: { resolveDiscretionary: jest.Mock };

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(q(null)), // default: no existing doc
      findOneAndUpdate: jest.fn().mockReturnValue(q(mockFormDoc)),
      create: jest.fn().mockResolvedValue(mockFormDoc),
    };
    historyModel = {
      create: jest.fn().mockResolvedValue({}),
    };
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue({ data: mockFormQuestions }),
      findByType: jest.fn().mockResolvedValue({ data: mockFormQuestions }),
    };
    validator = {
      validateDraftAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { sfcStatus: 'active' },
      }),
      validateFinalSubmitAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { sfcStatus: 'active' },
      }),
    };
    mockExemptionResolverService = {
      resolveDiscretionary: jest.fn().mockResolvedValue(null), // default: no exemption on record
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SfcStatusService,
        { provide: getModelToken(XviFcSfcStatus.name), useValue: formModel },
        { provide: getModelToken(XviFcSfcStatusHistory.name), useValue: historyModel },
        { provide: FormJsonService, useValue: formJsonService },
        { provide: DynamicFormValidationService, useValue: validator },
        {
          provide: XvifcFormActorsService,
          useValue: { buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Test State' }) },
        },
        { provide: ExcelService, useValue: { generateExcel: jest.fn() } },
        {
          provide: FileTokenService,
          useValue: {
            signFileUrl: jest.fn().mockReturnValue('https://signed-url'),
            signFileUrlForSession: jest.fn().mockReturnValue('https://signed-url'),
            createToken: jest.fn().mockReturnValue('mock-token'),
          },
        },
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        FileInfoNormalizerService,
        { provide: ExemptionResolverService, useValue: mockExemptionResolverService },
      ],
    }).compile();

    service = module.get(SfcStatusService);
  });

  // ─── saveDraft ───────────────────────────────────────────────────────────

  describe('saveDraft', () => {
    it('returns success:true with message and data on valid draft', async () => {
      const result = await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
        data: expect.any(Object),
      });
      expect((result.message ?? '').length).toBeGreaterThan(0);
    });

    it('throws BadRequestException with field-keyed errors map when validation fails', async () => {
      const fieldErrors: XviFcValidationErrorMap = {
        sfcStatus: [{ field: 'sfcStatus', message: 'SFC Status is required', code: 'required' }],
      };
      (validator.validateDraftAndBuildPayload as jest.Mock).mockReturnValue({
        isValid: false,
        errors: fieldErrors,
        sanitizedPayload: {},
      });

      let caught: unknown;
      try {
        await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      expect(typeof response['message']).toBe('string');
      expect((response['message'] as string).length).toBeGreaterThan(0);

      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(Array.isArray(errors)).toBe(false);
      expect(typeof errors).toBe('object');
      expect(errors).toHaveProperty('sfcStatus');
      expect(Array.isArray(errors['sfcStatus'])).toBe(true);
      expect(errors['sfcStatus'][0]).toMatchObject({ message: expect.any(String) });
    });

    it('throws ForbiddenException when state user accesses a different state', async () => {
      const wrongState = stateUser(new Types.ObjectId());
      await expect(service.saveDraft(validDto, wrongState, '127.0.0.1', 'jest')).rejects.toThrow(ForbiddenException);
    });

    it('successful response does not include errors field', async () => {
      const result = await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      expect(result).not.toHaveProperty('errors');
    });

    it('persists file metadata with pageCount from the sanitized payload', async () => {
      (validator.validateDraftAndBuildPayload as jest.Mock).mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          sfcReport: {
            fileName: 'sfc-report.pdf',
            fileUrl: 'state/sfc/sfc-report.pdf',
            fileSize: 2048,
            mimeType: 'application/pdf',
            pageCount: 4,
          },
        },
      });

      await service.saveDraft(
        {
          stateId: stateOid.toString(),
          yearId: yearOid.toString(),
          data: {
            sfcReport: {
              fileName: 'sfc-report.pdf',
              fileUrl: 'state/sfc/sfc-report.pdf',
              fileSize: 2048,
              mimeType: 'application/pdf',
              pageCount: 4,
            },
          },
        },
        adminUser,
        '127.0.0.1',
        'jest',
      );

      // No existing doc → create path; the sanitized payload lands in `data` untouched
      const createArg = (formModel['create'].mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      const savedFile = (createArg['data'] as Record<string, unknown>)['sfcReport'] as { pageCount?: number | null };
      expect(savedFile.pageCount).toBe(4);
    });

    // ─── form history logging ──────────────────────────────────────────────

    it('writes a CREATE_DRAFT history row on the very first save (NOT_STARTED → IN_PROGRESS)', async () => {
      await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');

      expect(historyModel['create']).toHaveBeenCalledWith(
        expect.objectContaining({
          action: FormHistoryAction.CREATE_DRAFT,
          fromStatus: FORM_STATUS.NOT_STARTED,
          toStatus: FORM_STATUS.IN_PROGRESS,
        }),
      );
    });

    it('writes no history row when the form is already IN_PROGRESS (no real status change)', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: docOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, data: {} }));

      await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');

      expect(historyModel['create']).not.toHaveBeenCalled();
    });

    it('guards the update filter with the read-time status', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: docOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, data: {} }));

      await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');

      expect(formModel['findOneAndUpdate']).toHaveBeenCalledWith(
        expect.objectContaining({ currentFormStatus: FORM_STATUS.IN_PROGRESS }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('rejects with the current status when a concurrent write changed status since the read', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValueOnce(q({ _id: docOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, data: {} }))
        .mockReturnValueOnce(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      formModel['findOneAndUpdate'] = jest.fn().mockReturnValue(q(null));

      await expect(service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest')).rejects.toThrow(ForbiddenException);
      expect(historyModel['create']).not.toHaveBeenCalled();
    });

    it('rejects with a conflict error when two first-saves race on create', async () => {
      formModel['create'] = jest.fn().mockRejectedValue({ code: 11000 });

      let caught: unknown;
      try {
        await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(errors['_form']?.[0]).toMatchObject({ code: 'conflict' });
    });
  });

  // ─── finalSubmit ─────────────────────────────────────────────────────────

  describe('finalSubmit', () => {
    beforeEach(() => {
      // finalSubmit requires assertCanStateFinalSubmitForm to pass — use NOT_STARTED so submission is allowed
      formModel['findOne'] = jest.fn().mockReturnValue(q(null)); // no existing doc → NOT_STARTED
    });

    it('returns success:true on valid final submit', async () => {
      // Final submit creates the record when no existing doc
      formModel['create'] = jest.fn().mockResolvedValue(mockFormDoc);
      const result = await service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      expect(result).toMatchObject({ success: true, message: expect.any(String), data: expect.any(Object) });
    });

    it('throws BadRequestException with field-keyed errors map when validation fails', async () => {
      const fieldErrors: XviFcValidationErrorMap = {
        sfcStatus: [{ field: 'sfcStatus', message: 'SFC Status is required for final submit', code: 'required' }],
        checkboxConfirmation: [{ field: 'checkboxConfirmation', message: 'Must be confirmed', code: 'requiredTrue' }],
      };
      (validator.validateFinalSubmitAndBuildPayload as jest.Mock).mockReturnValue({
        isValid: false,
        errors: fieldErrors,
        sanitizedPayload: {},
      });

      let caught: unknown;
      try {
        await service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      expect(typeof response['message']).toBe('string');
      expect((response['message'] as string).length).toBeGreaterThan(0);

      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(Array.isArray(errors)).toBe(false);
      expect(errors).toHaveProperty('sfcStatus');
      expect(errors).toHaveProperty('checkboxConfirmation');
    });

    it('writes a FINAL_SUBMIT history row (NOT_STARTED → UNDER_REVIEW_BY_MOHUA)', async () => {
      formModel['create'] = jest.fn().mockResolvedValue(mockFormDoc);

      await service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');

      expect(historyModel['create']).toHaveBeenCalledWith(
        expect.objectContaining({
          action: FormHistoryAction.FINAL_SUBMIT,
          fromStatus: FORM_STATUS.NOT_STARTED,
          toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        }),
      );
    });

    it('guards the update filter with the read-time status', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: docOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, data: {} }));

      await service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');

      expect(formModel['findOneAndUpdate']).toHaveBeenCalledWith(
        expect.objectContaining({ _id: docOid, currentFormStatus: FORM_STATUS.IN_PROGRESS }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('rejects when a second concurrent final submit already changed status', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValueOnce(q({ _id: docOid, currentFormStatus: FORM_STATUS.IN_PROGRESS, data: {} }))
        .mockReturnValueOnce(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      formModel['findOneAndUpdate'] = jest.fn().mockReturnValue(q(null));

      await expect(service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest')).rejects.toThrow(ForbiddenException);
      expect(historyModel['create']).not.toHaveBeenCalled();
    });

    it('rejects with a conflict error when two first-submits race on create', async () => {
      formModel['create'] = jest.fn().mockRejectedValue({ code: 11000 });

      let caught: unknown;
      try {
        await service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(errors['_form']?.[0]).toMatchObject({ code: 'conflict' });
    });
  });

  // ─── getForm ─────────────────────────────────────────────────────────────

  describe('getForm', () => {
    it('returns success:true with data including currentFormStatus and permissions', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(mockFormDoc));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
        data: expect.objectContaining({
          currentFormStatus: expect.any(Number),
          permissions: expect.objectContaining({ canView: expect.any(Boolean) }),
        }),
      });
    });

    it('returns success:true even when no form document exists yet (NOT_STARTED)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result).toMatchObject({ success: true });
      expect(result.data?.currentFormStatus).toBe(FORM_STATUS.NOT_STARTED);
    });

    it('throws ForbiddenException when state user accesses a different state', async () => {
      const wrongState = stateUser(new Types.ObjectId());
      await expect(service.getForm(stateOid.toString(), yearOid.toString(), wrongState)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the saved pageCount on hydrated file values alongside the signed URL', async () => {
      const fileQuestion = { key: 'sfcReport', formFieldType: 'file', label: 'SFC Report', value: null };
      (formJsonService.findActiveByDesignYearAndFormId as jest.Mock).mockResolvedValue({ data: [fileQuestion] });
      (formJsonService.findByType as jest.Mock).mockResolvedValue({ data: [fileQuestion] });

      formModel['findOne'] = jest.fn().mockReturnValue(
        q({
          ...mockFormDoc,
          data: {
            sfcReport: {
              originalName: 'sfc-report.pdf',
              path: 'state/sfc/sfc-report.pdf',
              mimeType: 'application/pdf',
              sizeKb: 2,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              pageCount: 7,
            },
          },
        }),
      );

      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const questions = (result.data as Record<string, unknown>)['questions'] as Array<Record<string, unknown>>;
      const fileQ = questions.find((question) => question['key'] === 'sfcReport');

      const fileValue = fileQ!['value'] as { path: string; pageCount?: number | null };
      expect(fileValue.pageCount).toBe(7);
      expect(fileValue.path).not.toBe('state/sfc/sfc-report.pdf'); // re-signed, not the raw path
    });

    it('surfaces PENDING/APPROVED/REJECTED discretionary exemption status alongside mohuaRemarks, and zeroes canEdit/canFinalSubmit only while Pending/Approved', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(mockFormDoc)); // currentFormStatus: IN_PROGRESS - naturally editable

      mockExemptionResolverService.resolveDiscretionary.mockResolvedValueOnce({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });
      let result = await service.getForm(stateOid.toString(), yearOid.toString(), fullyPermissionedAdminUser);
      expect(result.data).toMatchObject({ exemptionStatus: 'PENDING', exemptionMohuaRemarks: null });
      expect(mockExemptionResolverService.resolveDiscretionary).toHaveBeenCalledWith(
        null,
        expect.any(Types.ObjectId),
        22,
        expect.any(Types.ObjectId),
      );
      // Blocked while Pending, even though the form's own status (IN_PROGRESS) is editable - the
      // write endpoints would reject both actions right now (assertNotBlockedByExemption), so the
      // response must not advertise them.
      expect(result.data?.permissions).toMatchObject({ canEdit: false, canFinalSubmit: false });

      mockExemptionResolverService.resolveDiscretionary.mockResolvedValueOnce({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: null,
      });
      result = await service.getForm(stateOid.toString(), yearOid.toString(), fullyPermissionedAdminUser);
      expect(result.data).toMatchObject({ exemptionStatus: 'APPROVED', exemptionMohuaRemarks: null });
      expect(result.data?.permissions).toMatchObject({ canEdit: false, canFinalSubmit: false });

      mockExemptionResolverService.resolveDiscretionary.mockResolvedValueOnce({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: 'Not eligible',
      });
      result = await service.getForm(stateOid.toString(), yearOid.toString(), fullyPermissionedAdminUser);
      expect(result.data).toMatchObject({ exemptionStatus: 'REJECTED', exemptionMohuaRemarks: 'Not eligible' });
      // Rejected - the form's real (editable) status governs again, unaffected by this override.
      expect(result.data?.permissions).toMatchObject({ canEdit: true, canFinalSubmit: true });
    });

    it('returns exemptionStatus:null when no discretionary request has ever been filed, permissions unaffected', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(mockFormDoc));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), fullyPermissionedAdminUser);
      expect(result.data).toMatchObject({ exemptionStatus: null, exemptionMohuaRemarks: null });
      expect(result.data?.permissions).toMatchObject({ canEdit: true, canFinalSubmit: true });
    });
  });

  // ─── discretionary exemption write-side guard ───────────────────────────────

  describe('write-side exemption guard (saveDraft / finalSubmit)', () => {
    it('saveDraft is blocked (409, not 403 - a 403 would force-log the user out) while a discretionary exemption request is pending MoHUA review', async () => {
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });

      const result = service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/pending MoHUA review/);
      expect(formModel['findOneAndUpdate']).not.toHaveBeenCalled();
      expect(formModel['create']).not.toHaveBeenCalled();
    });

    it('saveDraft is blocked (409, not 403) while a discretionary exemption request is MoHUA-approved', async () => {
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: null,
      });

      const result = service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/no submission is required/);
    });

    it('saveDraft proceeds normally once the discretionary request has been rejected', async () => {
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: 'No longer applicable',
      });

      const result = await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      expect(result.success).toBe(true);
    });

    it('finalSubmit is blocked (409, not 403) while a discretionary exemption request is pending MoHUA review', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        decidedAt: null,
        mohuaRemarks: null,
      });

      const result = service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/pending MoHUA review/);
    });

    it('finalSubmit is blocked (409, not 403) while a discretionary exemption request is MoHUA-approved', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      mockExemptionResolverService.resolveDiscretionary.mockResolvedValue({
        requestId: new Types.ObjectId(),
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        decidedAt: new Date(),
        mohuaRemarks: null,
      });

      const result = service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/no submission is required/);
    });

    it('finalSubmit re-checks right before the write and blocks (409) an exemption approved mid-flight (not just at the top of the method)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      formModel['create'] = jest.fn().mockResolvedValue(mockFormDoc);
      // Clear on the first check (top of the method); approved by the time the second check runs
      // right before the write - simulating a discretionary exemption filed *and* approved during
      // this call's own awaited work (loadFormQuestions/findOne/validation/normalization).
      mockExemptionResolverService.resolveDiscretionary
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          requestId: new Types.ObjectId(),
          currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
          decidedAt: new Date(),
          mohuaRemarks: null,
        });

      const result = service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(/no submission is required/);
      expect(mockExemptionResolverService.resolveDiscretionary).toHaveBeenCalledTimes(2);
      expect(formModel['create']).not.toHaveBeenCalled();
      expect(formModel['findOneAndUpdate']).not.toHaveBeenCalled();
    });
  });
});

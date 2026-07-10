import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { SfcStatusService } from './sfc-status.service';
import { XviFcSfcStatus } from '../../../../schemas/xvi-fc/state/sfc-status.schema';
import { XviFcSfcStatusHistory } from '../../../../schemas/xvi-fc/state/sfc-status-history.schema';
import { FormJsonService } from 'src/form-json/form-json.service';
import { DynamicFormValidationService } from '../../common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from '../../common/services/xvifc-form-actors.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
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
            createToken: jest.fn().mockReturnValue('mock-token'),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('24h') } },
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
              fileName: 'sfc-report.pdf',
              fileUrl: 'state/sfc/sfc-report.pdf',
              fileSize: 2048,
              mimeType: 'application/pdf',
              pageCount: 7,
            },
          },
        }),
      );

      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      const questions = (result.data as Record<string, unknown>)['questions'] as Array<Record<string, unknown>>;
      const fileQ = questions.find((question) => question['key'] === 'sfcReport');

      const fileValue = fileQ!['value'] as { fileUrl: string; pageCount?: number | null };
      expect(fileValue.pageCount).toBe(7);
      expect(fileValue.fileUrl).not.toBe('state/sfc/sfc-report.pdf'); // re-signed, not the raw path
    });
  });
});

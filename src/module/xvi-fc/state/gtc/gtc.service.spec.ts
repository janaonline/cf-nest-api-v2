import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { GtcService } from './gtc.service';
import { XviFcGtc } from '../../../../schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory } from '../../../../schemas/xvi-fc/state/gtc-form-history.schema';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { DynamicFormValidationService } from '../../common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from '../../common/services/xvifc-form-actors.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';
import { FileUrlNormalizerService } from '../../common/services/file-url-normalizer.service';
import { FileInfoNormalizerService } from '../../common/services/file-info-normalizer.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { XviFcValidationErrorMap } from '../../common/response/xvi-fc-api-response';
import type { SaveGtcDto } from './dto/save-gtc.dto';

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
  installment: 1,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  data: {},
  toObject: () => ({
    _id: docOid,
    state: stateOid,
    year: yearOid,
    installment: 1,
    currentFormStatus: FORM_STATUS.IN_PROGRESS,
    data: {},
  }),
};

const mockFormQuestions = [{ key: 'i2GtcFile', formFieldType: 'file', label: 'GTC File', value: null }];

const mockTemplateField = {
  key: 'i2GtcFile',
  formFieldType: 'file',
  label: 'GTC File',
  value: null,
  supportingContent: [
    {
      type: 'actions',
      position: 'before',
      actions: [
        {
          id: 'download-template',
          label: 'Download the GTC template',
          meta: {
            path: 'xvi-fc/state/common/2026-27/gtc/gtc-template/template.docx',
            fileName: 'GTC-Template-2026-27.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        },
      ],
    },
  ],
};

const validDto: SaveGtcDto = {
  stateId: stateOid.toString(),
  yearId: yearOid.toString(),
  installment: 1,
  data: { i2GtcFile: null },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GtcService', () => {
  let service: GtcService;
  let formModel: Record<string, jest.Mock>;
  let historyModel: Record<string, jest.Mock>;
  let formJsonService: Partial<FormJsonService>;
  let validator: Partial<DynamicFormValidationService>;
  let s3Service: Partial<S3Service>;

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
        sanitizedPayload: { i2GtcFile: null },
      }),
      validateFinalSubmitAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { i2GtcFile: null },
      }),
    };
    s3Service = {
      headObject: jest.fn().mockResolvedValue({ ContentLength: 1024 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GtcService,
        { provide: getModelToken(XviFcGtc.name), useValue: formModel },
        { provide: getModelToken(XviFcGtcHistory.name), useValue: historyModel },
        { provide: FormJsonService, useValue: formJsonService },
        { provide: DynamicFormValidationService, useValue: validator },
        {
          provide: XvifcFormActorsService,
          useValue: { buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Test State' }) },
        },
        {
          provide: FileTokenService,
          useValue: {
            signFileUrl: jest.fn().mockReturnValue('https://signed-url'),
            signFileUrlForSession: jest.fn().mockReturnValue('https://signed-url'),
            createToken: jest.fn().mockReturnValue('mock-token'),
          },
        },
        { provide: S3Service, useValue: s3Service },
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        FileInfoNormalizerService,
      ],
    }).compile();

    service = module.get(GtcService);
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
    });

    it('upserts scoped by state + year + installment', async () => {
      await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');
      expect(formModel['findOne']).toHaveBeenCalledWith(
        expect.objectContaining({ state: stateOid, year: yearOid, installment: 1 }),
        expect.anything(),
      );
    });

    it('throws BadRequestException with field-keyed errors map when validation fails', async () => {
      const fieldErrors: XviFcValidationErrorMap = {
        i2GtcFile: [{ field: 'i2GtcFile', message: 'GTC file is required', code: 'required' }],
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
      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(errors).toHaveProperty('i2GtcFile');
    });

    it('throws ForbiddenException when state user accesses a different state', async () => {
      const wrongState = stateUser(new Types.ObjectId());
      await expect(service.saveDraft(validDto, wrongState, '127.0.0.1', 'jest')).rejects.toThrow(ForbiddenException);
    });

    it('writes a CREATE_DRAFT history row on the very first save (NOT_STARTED → IN_PROGRESS)', async () => {
      await service.saveDraft(validDto, adminUser, '127.0.0.1', 'jest');

      expect(historyModel['create']).toHaveBeenCalledWith(
        expect.objectContaining({
          installment: 1,
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
  });

  // ─── finalSubmit ─────────────────────────────────────────────────────────

  describe('finalSubmit', () => {
    beforeEach(() => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null)); // no existing doc → NOT_STARTED
    });

    it('returns success:true on valid final submit', async () => {
      formModel['create'] = jest.fn().mockResolvedValue(mockFormDoc);
      const result = await service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest');
      expect(result).toMatchObject({ success: true, message: expect.any(String), data: expect.any(Object) });
    });

    it('throws BadRequestException with field-keyed errors map when validation fails', async () => {
      const fieldErrors: XviFcValidationErrorMap = {
        i2GtcFile: [{ field: 'i2GtcFile', message: 'GTC file is required for final submit', code: 'required' }],
      };
      (validator.validateFinalSubmitAndBuildPayload as jest.Mock).mockReturnValue({
        isValid: false,
        errors: fieldErrors,
        sanitizedPayload: {},
      });

      await expect(service.finalSubmit(validDto, adminUser, '127.0.0.1', 'jest')).rejects.toBeInstanceOf(
        BadRequestException,
      );
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

    it('rejects installment 2 with installment2Locked before running any validation', async () => {
      const installment2Dto: SaveGtcDto = { ...validDto, installment: 2 };

      let caught: unknown;
      try {
        await service.finalSubmit(installment2Dto, adminUser, '127.0.0.1', 'jest');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(errors['installment']?.[0]).toMatchObject({ code: 'installment2Locked' });
      expect(validator.validateFinalSubmitAndBuildPayload).not.toHaveBeenCalled();
    });
  });

  // ─── getForm ─────────────────────────────────────────────────────────────

  describe('getForm', () => {
    it('returns success:true with data including installment, currentFormStatus, and permissions', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(mockFormDoc));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), 1, adminUser);
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
        data: expect.objectContaining({
          installment: 1,
          currentFormStatus: expect.any(Number),
          permissions: expect.objectContaining({ canView: expect.any(Boolean) }),
        }),
      });
    });

    it('returns success:true even when no form document exists yet (NOT_STARTED)', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), 1, adminUser);
      expect(result).toMatchObject({ success: true });
      expect(result.data?.currentFormStatus).toBe(FORM_STATUS.NOT_STARTED);
    });

    it('throws ForbiddenException when state user accesses a different state', async () => {
      const wrongState = stateUser(new Types.ObjectId());
      await expect(service.getForm(stateOid.toString(), yearOid.toString(), 1, wrongState)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('reports installment 2 as locked and installment 1 as unlocked', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), 1, adminUser);
      expect(result.data?.installmentAccess).toEqual({
        installment1: { canSelect: true, locked: false, lockReason: null },
        installment2: { canSelect: false, locked: true, lockReason: expect.any(String) },
      });
    });

    it('hides the download-template action when the form is not editable', async () => {
      (formJsonService.findActiveByDesignYearAndFormId as jest.Mock).mockResolvedValue({ data: [mockTemplateField] });
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ ...mockFormDoc, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));

      const result = await service.getForm(stateOid.toString(), yearOid.toString(), 1, adminUser);
      const questions = (result.data as Record<string, unknown>)['questions'] as Array<Record<string, unknown>>;
      const field = questions.find((question) => question['key'] === 'i2GtcFile') as {
        supportingContent: Array<{ actions: Array<{ id: string; visible?: boolean; meta?: unknown }> }>;
      };

      expect(field.supportingContent[0].actions[0].visible).toBe(false);
    });

    it('strips meta from supportingContent actions before returning to the client', async () => {
      (formJsonService.findActiveByDesignYearAndFormId as jest.Mock).mockResolvedValue({ data: [mockTemplateField] });

      const result = await service.getForm(stateOid.toString(), yearOid.toString(), 1, adminUser);
      const questions = (result.data as Record<string, unknown>)['questions'] as Array<Record<string, unknown>>;
      const field = questions.find((question) => question['key'] === 'i2GtcFile') as {
        supportingContent: Array<{ actions: Array<{ id: string; meta?: unknown }> }>;
      };

      expect(field.supportingContent[0].actions[0]).not.toHaveProperty('meta');
    });
  });

  // ─── getTemplate ─────────────────────────────────────────────────────────

  describe('getTemplate', () => {
    it('throws templateNotConfigured when no field configures a download-template action', async () => {
      let caught: unknown;
      try {
        await service.getTemplate(stateOid.toString(), yearOid.toString(), 1, adminUser);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(errors['_form']?.[0]).toMatchObject({ code: 'templateNotConfigured' });
    });

    it('throws templateUnavailable when the configured S3 object is missing', async () => {
      (formJsonService.findActiveByDesignYearAndFormId as jest.Mock).mockResolvedValue({ data: [mockTemplateField] });
      (s3Service.headObject as jest.Mock).mockRejectedValue(new Error('not found'));

      let caught: unknown;
      try {
        await service.getTemplate(stateOid.toString(), yearOid.toString(), 1, adminUser);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errors = response['errors'] as XviFcValidationErrorMap;
      expect(errors['_form']?.[0]).toMatchObject({ code: 'templateUnavailable' });
    });

    it('returns a signed url when the template is configured and the S3 object exists', async () => {
      (formJsonService.findActiveByDesignYearAndFormId as jest.Mock).mockResolvedValue({ data: [mockTemplateField] });

      const result = await service.getTemplate(stateOid.toString(), yearOid.toString(), 1, adminUser);

      expect(result).toMatchObject({
        success: true,
        data: {
          fileName: 'GTC-Template-2026-27.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          url: 'https://signed-url',
        },
      });
    });

    it('throws ForbiddenException when the form status does not allow editing', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));

      await expect(service.getTemplate(stateOid.toString(), yearOid.toString(), 1, adminUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when state user accesses a different state', async () => {
      const wrongState = stateUser(new Types.ObjectId());
      await expect(service.getTemplate(stateOid.toString(), yearOid.toString(), 1, wrongState)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SlbService } from './slb.service';
import { SlbForm } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { SlbFormJsonConfigService } from './services/slb-form-json.service';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { SaveSlbDto } from './dto/save-slb.dto';

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

const ulbOid = new Types.ObjectId();
const otherUlbOid = new Types.ObjectId();
const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId('67d7d136d3d038946a5239e9'); // 2026-27
const docOid = new Types.ObjectId();

const ulbUser = (ulb: Types.ObjectId, accessLevel: AccessLevel | null = AccessLevel.EDITOR): AuthUser =>
  ({
    _id: new Types.ObjectId().toString(),
    scope: Scope.ULB,
    accessLevel,
    ulb,
  }) as unknown as AuthUser;

const stateUser = (state: Types.ObjectId): AuthUser =>
  ({
    _id: new Types.ObjectId().toString(),
    scope: Scope.STATE,
    state,
  }) as unknown as AuthUser;

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  scope: Scope.ADMIN,
} as unknown as AuthUser;

const mockFormDoc = {
  _id: docOid,
  ulb: ulbOid,
  year: yearOid,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  data: {},
  toObject: () => ({
    _id: docOid,
    ulb: ulbOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.IN_PROGRESS,
    data: {},
  }),
};

const mockSlbFields = [
  { key: 'ind1_actual', formFieldType: 'number', label: 'Indicator 1 Actual', fieldTypes: ['SLB_MAIN_FORM_FIELDS'] },
  {
    key: 'checkboxConfirmation',
    formFieldType: 'checkbox',
    label: 'Confirmation',
    fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
    validations: [{ name: 'requiredTrue', validator: null, message: 'You must confirm.' }],
  },
];

const validDto: SaveSlbDto = {
  ulbId: ulbOid.toString(),
  yearId: yearOid.toString(),
  data: { ind1_actual: 10 },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SlbService', () => {
  let service: SlbService;
  let formModel: Record<string, jest.Mock>;
  let ulbModel: Record<string, jest.Mock>;
  let slbFormJsonConfig: Partial<SlbFormJsonConfigService>;
  let validator: Partial<DynamicFormValidationService>;

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(q(null)), // default: no existing doc
      findOneAndUpdate: jest.fn().mockReturnValue(q(mockFormDoc)),
      create: jest.fn().mockResolvedValue(mockFormDoc),
    };
    ulbModel = {
      findById: jest.fn().mockReturnValue(q({ _id: ulbOid, state: stateOid })),
    };
    slbFormJsonConfig = {
      loadFields: jest.fn().mockResolvedValue(mockSlbFields),
    };
    validator = {
      validateDraftAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { ind1_actual: 10 },
      }),
      validateFinalSubmitAndBuildPayload: jest.fn().mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { ind1_actual: 10 },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlbService,
        { provide: getModelToken(SlbForm.name), useValue: formModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: DynamicFormValidationService, useValue: validator },
        { provide: FileTokenService, useValue: { signFileUrl: jest.fn((u: string) => `signed::${u}`) } },
        { provide: SlbFormJsonConfigService, useValue: slbFormJsonConfig },
        {
          provide: UlbEligibilityService,
          useValue: { assertUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<SlbService>(SlbService);
  });

  describe('resolveEffectiveUlbId', () => {
    it('resolves a ULB user to their own ulb', async () => {
      const id = await service.resolveEffectiveUlbId(ulbUser(ulbOid));
      expect(id).toBe(ulbOid.toString());
    });

    it('rejects a ULB user requesting a different ulb', async () => {
      await expect(service.resolveEffectiveUlbId(ulbUser(ulbOid), otherUlbOid.toString())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('requires an explicit ulbId for STATE users', async () => {
      await expect(service.resolveEffectiveUlbId(stateUser(stateOid))).rejects.toThrow(BadRequestException);
    });

    it('requires an explicit ulbId for ADMIN users', async () => {
      await expect(service.resolveEffectiveUlbId(adminUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('assertCanReadSlb', () => {
    it('allows a STATE user to read a ULB within their own state', async () => {
      await expect(service.assertCanReadSlb(stateUser(stateOid), ulbOid.toString())).resolves.toBeUndefined();
    });

    it('rejects a STATE user reading a ULB outside their own state', async () => {
      ulbModel.findById.mockReturnValue(q({ _id: ulbOid, state: new Types.ObjectId() }));
      await expect(service.assertCanReadSlb(stateUser(stateOid), ulbOid.toString())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getForm', () => {
    it('signs a CommonFile-shaped stored value (path) into a downloadable fileUrl', async () => {
      (slbFormJsonConfig.loadFields as jest.Mock).mockResolvedValue([
        {
          key: 'supportingDocumentFile',
          formFieldType: 'file',
          label: 'Supporting Document',
          fieldTypes: ['SLB_MAIN_FORM_FIELDS'],
        },
      ]);

      const storedPath =
        'xvi-fc/ulb/681dd165c11cf21bf1cfd06a/2026-27/slb/supporting-document/income-statement-schedules.pdf';
      formModel.findOne.mockReturnValue(
        q({
          _id: docOid,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          data: {
            supportingDocumentFile: {
              originalName: 'income-statement-schedules.pdf',
              path: storedPath,
              mimeType: 'application/pdf',
              extension: 'pdf',
              sizeKb: 964.44,
              pageCount: 6,
            },
          },
        }),
      );

      const result = await service.getForm(ulbOid.toString(), yearOid.toString(), ulbUser(ulbOid));

      const questions = (result.data as { questions: Array<{ key: string; value?: Record<string, unknown> }> })
        .questions;
      const fileQuestion = questions.find((q) => q.key === 'supportingDocumentFile');

      expect(fileQuestion?.value?.['fileUrl']).toBe(`signed::${storedPath}`);
      expect(fileQuestion?.value?.['path']).toBe(storedPath);
    });
  });

  describe('assertCanSubmitSlb', () => {
    it('rejects a ULB viewer from submitting', async () => {
      await expect(
        service.assertCanSubmitSlb(ulbUser(ulbOid, AccessLevel.VIEWER), ulbOid.toString()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects STATE users from submitting', async () => {
      await expect(service.assertCanSubmitSlb(stateUser(stateOid), ulbOid.toString())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows the owning ULB editor to submit', async () => {
      await expect(
        service.assertCanSubmitSlb(ulbUser(ulbOid, AccessLevel.EDITOR), ulbOid.toString()),
      ).resolves.toBeUndefined();
    });
  });

  describe('saveDraft', () => {
    it('creates a new draft when none exists and sets status to IN_PROGRESS', async () => {
      const result = await service.saveDraft(validDto, ulbUser(ulbOid));

      expect(formModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ ulb: ulbOid, currentFormStatus: FORM_STATUS.IN_PROGRESS }),
      );
      expect(result.success).toBe(true);
    });

    it('throws when validation fails', async () => {
      (validator.validateDraftAndBuildPayload as jest.Mock).mockReturnValue({
        isValid: false,
        errors: { ind1_actual: [{ field: 'ind1_actual', code: 'required', message: 'Required' }] },
        sanitizedPayload: {},
      });

      await expect(service.saveDraft(validDto, ulbUser(ulbOid))).rejects.toThrow(BadRequestException);
    });

    it('blocks a viewer from saving a draft', async () => {
      await expect(service.saveDraft(validDto, ulbUser(ulbOid, AccessLevel.VIEWER))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('strips the requiredTrue validator before validating, so an unchecked confirmation checkbox does not block a draft', async () => {
      await service.saveDraft(validDto, ulbUser(ulbOid));

      const fieldsPassed = (validator.validateDraftAndBuildPayload as jest.Mock).mock.calls[0][0];
      const checkboxField = fieldsPassed.find((f: { key: string }) => f.key === 'checkboxConfirmation');
      expect(checkboxField.validations).toEqual([]);
    });
  });

  describe('finalSubmit', () => {
    it('transitions status to UNDER_REVIEW_BY_STATE on first submit', async () => {
      const result = await service.finalSubmit(validDto, ulbUser(ulbOid));

      expect(formModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ ulb: ulbOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }),
      );
      expect(result.success).toBe(true);
    });

    it('blocks re-submission when status does not allow it', async () => {
      formModel.findOne.mockReturnValue(
        q({ _id: docOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }),
      );

      await expect(service.finalSubmit(validDto, ulbUser(ulbOid))).rejects.toThrow(ForbiddenException);
    });

    it('keeps the requiredTrue validator intact — final submit still enforces the confirmation checkbox', async () => {
      await service.finalSubmit(validDto, ulbUser(ulbOid));

      const fieldsPassed = (validator.validateFinalSubmitAndBuildPayload as jest.Mock).mock.calls[0][0];
      const checkboxField = fieldsPassed.find((f: { key: string }) => f.key === 'checkboxConfirmation');
      expect(checkboxField.validations).toEqual([{ name: 'requiredTrue', validator: null, message: 'You must confirm.' }]);
    });
  });
});

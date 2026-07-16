import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FcUnspentDeclarationService } from './fc-unspent-declaration.service';
import { FcUnspentDeclarationRowService } from '../rows/fc-unspent-declaration-row.service';
import { FcUnspentDeclarationFormJsonService } from '../form-json/fc-unspent-declaration-form-json.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';
import {
  XviFcUnspentStateForm,
  XviFcUnspentStateFormSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcUnspentStateFormHistory } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { ROW_STATUS } from 'src/common/constants/row-status.constants';
import {
  FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL,
  FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID,
  FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR,
} from '../../constants/fc-unspent-declaration.constants';
import { FC_UNSPENT_STATE_FORM_JSON } from '../../constants/fc-unspent-declaration.form-json.constant';
import type { SaveFcUnspentDeclarationDto } from '../../dto/save-fc-unspent-declaration.dto';
import type { FcUnspentResolvedRow } from '../../types/fc-unspent-declaration.types';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'populate']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const YEAR_2026_27 = '67d7d136d3d038946a5239e9';

const stateOid = new Types.ObjectId();
const otherStateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId(YEAR_2026_27);
const userOid = new Types.ObjectId();
const devolutionFormOid = new Types.ObjectId();
const parentOid = new Types.ObjectId();
const ulbOid1 = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: userOid.toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
} as unknown as AuthUser;

const stateUser = (state: Types.ObjectId = stateOid): AuthUser =>
  ({ _id: userOid.toString(), scope: Scope.STATE, state, xviFcSubrole: 'admin' }) as unknown as AuthUser;

function makeDevolutionForm(status: number, activeDatasetVersion = 1) {
  return { _id: devolutionFormOid, currentFormStatus: status, activeDatasetVersion };
}

function baseDto(data: Partial<SaveFcUnspentDeclarationDto['data']> = {}): SaveFcUnspentDeclarationDto {
  return {
    stateId: stateOid.toString(),
    yearId: yearOid.toString(),
    data: data as SaveFcUnspentDeclarationDto['data'],
  };
}

const sampleResolvedRow: FcUnspentResolvedRow = {
  ulbId: ulbOid1,
  censusCode: '111',
  sbCode: 'A1',
  ulbName: 'Alpha ULB',
  allocationAmount: 100,
  unspentAmount: 5,
  allocationPerc: 5,
  eligibility: true,
};

interface TestSetArg {
  fcDeclaration?: { path: string; originalName?: string; mimeType?: string; sizeKb?: number } | null;
  currentFormStatus: number;
  isDraft?: boolean;
}

/** Reads the `$set` payload from the first `findOneAndUpdate` call, typed for test assertions. */
function getSetArg(mockFn: jest.Mock): TestSetArg {
  const calls = mockFn.mock.calls as unknown as Array<[unknown, { $set: TestSetArg }]>;
  return calls[0][1].$set;
}

interface TestHistoryArg {
  ip: string;
  userAgent: string;
  auditRevision: number;
  fromStatus: number;
  toStatus: number;
  unspentUlbData: Array<{ rowNumber: number; allocationPerc: number; eligibility: boolean }>;
}

/** Reads the history snapshot from the first `historyModel.create([...])` call. */
function getHistoryArg(mockFn: jest.Mock): TestHistoryArg {
  const calls = mockFn.mock.calls as unknown as Array<[[TestHistoryArg]]>;
  return calls[0][0][0];
}

/** Awaits a promise expected to reject with a BadRequestException and returns its first field-error message for `field`. */
async function getValidationErrorMessage(promise: Promise<unknown>, field: string): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse() as {
      errors: Record<string, Array<{ message: string }>>;
    };
    return response.errors[field]?.[0]?.message ?? '';
  }
  throw new Error('Expected promise to reject with a BadRequestException');
}

describe('FcUnspentDeclarationService', () => {
  let service: FcUnspentDeclarationService;
  let model: Record<string, jest.Mock>;
  let historyModel: Record<string, jest.Mock>;
  let devolutionFormModel: Record<string, jest.Mock>;
  let rowService: Record<string, jest.Mock>;
  let formJsonConfigService: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;
  let mockSession: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    model = {
      findOne: jest.fn().mockReturnValue(q(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(
        q({
          _id: parentOid,
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isFcUnspent: null,
          fcDeclaration: null,
          checkboxConfirmation: false,
        }),
      ),
      db: { startSession: jest.fn().mockResolvedValue(mockSession) } as unknown as Record<string, jest.Mock>,
    };
    historyModel = {
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    };
    devolutionFormModel = {
      findOne: jest.fn().mockReturnValue(q(makeDevolutionForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA))),
    };
    rowService = {
      resolveAndValidateRows: jest.fn().mockResolvedValue({ rows: [], errors: {} }),
      applyRows: jest.fn().mockResolvedValue({ transitions: [] }),
      deactivateAllRows: jest.fn().mockResolvedValue(undefined),
      insertRowHistory: jest.fn().mockResolvedValue(undefined),
      getActiveRows: jest.fn().mockResolvedValue([]),
    };
    formJsonConfigService = {
      loadFields: jest.fn().mockResolvedValue(FC_UNSPENT_STATE_FORM_JSON.data),
    };
    s3Service = {
      headObject: jest.fn().mockResolvedValue({ ContentLength: 1024 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentDeclarationService,
        { provide: getModelToken(XviFcUnspentStateForm.name), useValue: model },
        { provide: getModelToken(XviFcUnspentStateFormHistory.name), useValue: historyModel },
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: devolutionFormModel },
        { provide: FcUnspentDeclarationRowService, useValue: rowService },
        { provide: FcUnspentDeclarationFormJsonService, useValue: formJsonConfigService },
        DynamicFormValidationService,
        XvifcFormActorsService,
        FileInfoNormalizerService,
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        { provide: FileTokenService, useValue: { signFileUrl: jest.fn((p: string) => `signed::${p}`) } },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get(FcUnspentDeclarationService);
  });

  // ─── Access control ─────────────────────────────────────────────────────────

  describe('access control', () => {
    it('allows a STATE user to view their own state', async () => {
      await expect(service.getForm(stateOid.toString(), yearOid.toString(), stateUser())).resolves.toBeDefined();
    });

    it('blocks a STATE user from viewing another state', async () => {
      await expect(service.getForm(otherStateOid.toString(), yearOid.toString(), stateUser(stateOid))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows ADMIN to view any state', async () => {
      await expect(service.getForm(otherStateOid.toString(), yearOid.toString(), adminUser)).resolves.toBeDefined();
    });
  });

  // ─── Design-year -> applicableFc mapping ───────────────────────────────────

  describe('design-year -> applicableFc mapping', () => {
    it('maps every documented design year to its FC cycle', () => {
      expect(FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL).toEqual({
        '2026-27': '14TH_FC',
        '2027-28': '14TH_FC',
        '2028-29': '15TH_FC',
        '2029-30': '15TH_FC',
        '2030-31': '15TH_FC',
      });
    });

    it('resolves applicableFc = 14TH_FC for the seeded 2026-27 yearId', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(result.data!.applicableFc).toBe('14TH_FC');
    });

    it('404s for a yearId that has no design-year label', async () => {
      const unknownYearId = new Types.ObjectId().toString();
      await expect(service.getForm(stateOid.toString(), unknownYearId, stateUser())).rejects.toThrow(
        'Design year not found',
      );
    });
  });

  // ─── Devolution dependency ──────────────────────────────────────────────────

  describe('devolution dependency', () => {
    it('grants full access when Devolution is UNDER_REVIEW_BY_MOHUA with an active dataset', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(result.data!.dependency).toEqual({
        devolutionStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        devolutionDatasetExists: true,
        editableDueToDevolutionReturn: false,
        blockingMessage: null,
      });
      expect(result.data!.permissions.canEdit).toBe(true);
      expect(result.data!.permissions.canSaveDraft).toBe(true);
      expect(result.data!.permissions.canFinalSubmit).toBe(true);
    });

    it('allows draft save but blocks final submit when Devolution is RETURNED_BY_MOHUA', async () => {
      devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(makeDevolutionForm(FORM_STATUS.RETURNED_BY_MOHUA)));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(result.data!.dependency.editableDueToDevolutionReturn).toBe(true);
      expect(result.data!.dependency.blockingMessage).not.toBeNull();
      expect(result.data!.permissions.canEdit).toBe(true);
      expect(result.data!.permissions.canSaveDraft).toBe(true);
      expect(result.data!.permissions.canFinalSubmit).toBe(false);
    });

    it('locks the entire form when the Devolution form or active dataset is missing', async () => {
      devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(null));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(result.data!.dependency.devolutionDatasetExists).toBe(false);
      expect(result.data!.permissions).toEqual({
        canView: true,
        canEdit: false,
        canSaveDraft: false,
        canFinalSubmit: false,
      });
    });

    it('locks the entire form when Devolution exists but has no active dataset version', async () => {
      devolutionFormModel['findOne'] = jest
        .fn()
        .mockReturnValue(q(makeDevolutionForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA, 0)));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(result.data!.permissions.canEdit).toBe(false);
    });
  });

  // ─── GET response shape ─────────────────────────────────────────────────────

  it('GET response never includes the full ULB options list', async () => {
    const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
    expect(Object.keys(result.data as object)).not.toContain('ulbOptions');
    expect(Object.keys(result.data as object)).not.toContain('unspentUlbOptions');
  });

  it('GET assembles active rows from the row collection, keyed by the parent form id, mapping rowNumber -> slNo', async () => {
    model['findOne'] = jest.fn().mockReturnValue(
      q({
        _id: parentOid,
        currentFormStatus: FORM_STATUS.IN_PROGRESS,
        isFcUnspent: true,
        checkboxConfirmation: true,
      }),
    );
    rowService['getActiveRows'] = jest.fn().mockResolvedValue([
      {
        rowNumber: 1,
        ulbId: ulbOid1,
        censusCode: '111',
        sbCode: 'A1',
        ulbName: 'Alpha ULB',
        allocationAmount: 100,
        unspentAmount: 5,
        allocationPerc: 5,
        eligibility: true,
      },
    ]);

    const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());

    expect(rowService['getActiveRows']).toHaveBeenCalledWith(parentOid);
    expect(result.data!.unspentUlbData).toEqual([
      {
        slNo: 1,
        ulbId: ulbOid1.toString(),
        censusCode: '111',
        sbCode: 'A1',
        ulbName: 'Alpha ULB',
        allocationAmount: 100,
        unspentAmount: 5,
        allocationPerc: 5,
        eligibility: true,
      },
    ]);
  });

  it('GET never queries rows when no parent form exists yet (NOT_STARTED)', async () => {
    const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
    expect(rowService['getActiveRows']).not.toHaveBeenCalled();
    expect(result.data!.unspentUlbData).toEqual([]);
  });

  // ─── Parent schema no longer stores embedded rows ──────────────────────────

  it('the parent schema no longer declares an embedded unspentUlbData path', () => {
    expect(XviFcUnspentStateFormSchema.path('unspentUlbData')).toBeUndefined();
  });

  // ─── Save draft ─────────────────────────────────────────────────────────────

  describe('saveDraft', () => {
    it('saves the No-branch with an optional declaration and deactivates the row set atomically', async () => {
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: {
          originalName: 'declaration.pdf',
          path: 'xvi-fc/state/x/2026-27/fc-declaration/declaration.pdf',
          mimeType: 'application/pdf',
          sizeKb: 100,
        },
      });
      await service.saveDraft(dto, stateUser());
      const setArg = getSetArg(model['findOneAndUpdate']);
      expect(setArg.fcDeclaration?.path).toContain('declaration.pdf');
      expect(setArg.currentFormStatus).toBe(FORM_STATUS.IN_PROGRESS);
      expect(rowService['deactivateAllRows']).toHaveBeenCalledWith(parentOid, userOid, mockSession);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('rejects a No-branch draft carrying unspentUlbData rows', async () => {
      const dto = baseDto({ isFcUnspent: false, unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }] });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(BadRequestException);
    });

    it('resolves partial Yes-branch rows via the row service and applies them in draft mode (rowStatus untouched)', async () => {
      // checkboxConfirmation carries a requiredTrue validator, which the shared
      // DynamicFormValidationService enforces even in draft mode whenever the field
      // is visible (isFcUnspent === true) — per the task brief's own rule ("requiredTrue
      // remains strict where visible"), matching every other XVI-FC state form.
      rowService['resolveAndValidateRows'].mockResolvedValueOnce({ rows: [sampleResolvedRow], errors: {} });
      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }],
      });
      await service.saveDraft(dto, stateUser());

      expect(rowService['resolveAndValidateRows']).toHaveBeenCalledWith(
        stateOid,
        dto.data.unspentUlbData,
        expect.objectContaining({ _id: devolutionFormOid }),
        { requireAtLeastOne: false },
      );
      expect(rowService['applyRows']).toHaveBeenCalledWith(
        parentOid,
        stateOid,
        yearOid,
        [sampleResolvedRow],
        userOid,
        undefined, // draft mode — never forces rowStatus
        mockSession,
      );
    });

    it('propagates row-service validation errors (e.g. missing/non-positive allocation) as a 400', async () => {
      rowService['resolveAndValidateRows'].mockResolvedValueOnce({
        rows: [],
        errors: { 'unspentUlbData.0.ulbId': [{ field: 'unspentUlbData.0.ulbId', code: 'noAllocation', message: 'x' }] },
      });
      const dto = baseDto({ isFcUnspent: true, unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }] });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(BadRequestException);
    });

    it('is blocked when Devolution is missing (form locked)', async () => {
      devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(null));
      const dto = baseDto({ isFcUnspent: false });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(BadRequestException);
    });

    it('rejects draft save when the form is already UNDER_REVIEW_BY_MOHUA (not editable)', async () => {
      model['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: parentOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      const dto = baseDto({ isFcUnspent: false });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(ForbiddenException);
    });

    it('rolls back the transaction if a row-service write fails during draft save', async () => {
      rowService['deactivateAllRows'] = jest.fn().mockRejectedValue(new Error('row write failed'));
      const dto = baseDto({ isFcUnspent: false });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow('row write failed');
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // ─── Final submit ───────────────────────────────────────────────────────────

  describe('finalSubmit', () => {
    it('final-submits the No-branch, requiring a signed declaration, and deactivates all rows', async () => {
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: {
          originalName: 'declaration.pdf',
          path: 'declaration.pdf',
          mimeType: 'application/pdf',
          sizeKb: 100,
        },
      });
      const result = await service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent');
      expect(result.data).toMatchObject({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      expect(rowService['deactivateAllRows']).toHaveBeenCalledWith(parentOid, userOid, mockSession);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('rejects the No-branch final submit when no declaration is present', async () => {
      const dto = baseDto({ isFcUnspent: false });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('final-submits the Yes-branch, forcing rowStatus to UPDATE_PENDING and writing row history for real transitions', async () => {
      rowService['resolveAndValidateRows'].mockResolvedValueOnce({ rows: [sampleResolvedRow], errors: {} });
      const transitions = [
        {
          rowId: new Types.ObjectId(),
          previousStatus: null,
          currentStatus: ROW_STATUS.UPDATE_PENDING,
          row: { ...sampleResolvedRow, rowNumber: 1 },
        },
      ];
      rowService['applyRows'].mockResolvedValueOnce({ transitions });

      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 10 }],
      });
      const result = await service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent');

      expect(result.data).toMatchObject({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      expect(rowService['applyRows']).toHaveBeenCalledWith(
        parentOid,
        stateOid,
        yearOid,
        [sampleResolvedRow],
        userOid,
        ROW_STATUS.UPDATE_PENDING,
        mockSession,
      );
      expect(rowService['insertRowHistory']).toHaveBeenCalledWith(
        parentOid,
        stateOid,
        yearOid,
        transitions,
        userOid,
        '127.0.0.1',
        'jest-agent',
        mockSession,
      );
    });

    it('rejects a Yes-branch final submit with zero rows (row service enforces requireAtLeastOne)', async () => {
      rowService['resolveAndValidateRows'].mockResolvedValueOnce({
        rows: [],
        errors: {
          unspentUlbData: [{ field: 'unspentUlbData', code: 'required', message: 'At least one ULB row is required.' }],
        },
      });
      const dto = baseDto({ isFcUnspent: true, checkboxConfirmation: true, unspentUlbData: [] });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a Yes-branch final submit without checkboxConfirmation', async () => {
      const dto = baseDto({
        isFcUnspent: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 10 }],
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates duplicate-ULB rejection from the row service', async () => {
      rowService['resolveAndValidateRows'].mockResolvedValueOnce({
        rows: [],
        errors: { unspentUlbData: [{ field: 'unspentUlbData', code: 'duplicateUlb', message: 'x' }] },
      });
      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [
          { ulbId: ulbOid1.toString(), unspentAmount: 5 },
          { ulbId: ulbOid1.toString(), unspentAmount: 7 },
        ],
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates the eligibility values computed by the row service into the parent-history snapshot unmodified', async () => {
      const boundaryRow: FcUnspentResolvedRow = {
        ...sampleResolvedRow,
        unspentAmount: 10,
        allocationPerc: 10,
        eligibility: true,
      };
      rowService['resolveAndValidateRows'].mockResolvedValueOnce({ rows: [boundaryRow], errors: {} });
      rowService['getActiveRows'].mockResolvedValueOnce([{ rowNumber: 1, ...boundaryRow }]);

      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 10 }],
      });
      await service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent');

      const historyArg = getHistoryArg(historyModel['create']);
      expect(historyArg.unspentUlbData[0]).toMatchObject({ rowNumber: 1, allocationPerc: 10, eligibility: true });
    });

    it('rejects when Devolution is not UNDER_REVIEW_BY_MOHUA at final submit time', async () => {
      devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(makeDevolutionForm(FORM_STATUS.RETURNED_BY_MOHUA)));
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: { originalName: 'd.pdf', path: 'd.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('blocks re-submission once the form is already UNDER_REVIEW_BY_MOHUA or ACKNOWLEDGED (terminal gate)', async () => {
      model['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: parentOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: { originalName: 'd.pdf', path: 'd.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        ForbiddenException,
      );

      model['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: parentOid, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }));
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('captures ip/userAgent on the parent history row and increments auditRevision', async () => {
      model['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: parentOid, currentFormStatus: FORM_STATUS.NOT_STARTED, auditRevision: 2 }));
      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }],
      });
      await service.finalSubmit(dto, stateUser(), '10.0.0.5', 'jest-agent/1.0');
      const historyArg = getHistoryArg(historyModel['create']);
      expect(historyArg.ip).toBe('10.0.0.5');
      expect(historyArg.userAgent).toBe('jest-agent/1.0');
      expect(historyArg.auditRevision).toBe(3);
      expect(historyArg.fromStatus).toBe(FORM_STATUS.NOT_STARTED);
      expect(historyArg.toStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('rolls back the transaction if the parent-history insert fails', async () => {
      historyModel['create'] = jest.fn().mockRejectedValue(new Error('history insert failed'));
      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }],
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        'history insert failed',
      );
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('rolls back the transaction if the row-status transition (applyRows) fails', async () => {
      rowService['applyRows'] = jest.fn().mockRejectedValue(new Error('row upsert failed'));
      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }],
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        'row upsert failed',
      );
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(historyModel['create']).not.toHaveBeenCalled();
    });

    it('rolls back the transaction if row-history insertion fails', async () => {
      rowService['insertRowHistory'] = jest.fn().mockRejectedValue(new Error('row history insert failed'));
      const dto = baseDto({
        isFcUnspent: true,
        checkboxConfirmation: true,
        unspentUlbData: [{ ulbId: ulbOid1.toString(), unspentAmount: 5 }],
      });
      await expect(service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent')).rejects.toThrow(
        'row history insert failed',
      );
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(historyModel['create']).not.toHaveBeenCalled();
    });
  });

  // ─── File normalization ─────────────────────────────────────────────────────

  describe('fcDeclaration file validation', () => {
    it('rejects a non-PDF extension', async () => {
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: {
          originalName: 'declaration.docx',
          path: 'declaration.docx',
          mimeType: 'application/pdf',
          sizeKb: 100,
        },
      });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-PDF MIME type', async () => {
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: { originalName: 'declaration.pdf', path: 'declaration.pdf', mimeType: 'image/png', sizeKb: 100 },
      });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(BadRequestException);
    });

    it('rejects a file over 5MB', async () => {
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: {
          originalName: 'declaration.pdf',
          path: 'declaration.pdf',
          mimeType: 'application/pdf',
          sizeKb: 6 * 1024,
        },
      });
      await expect(service.saveDraft(dto, stateUser())).rejects.toThrow(BadRequestException);
    });

    it('preserves stored timestamps when the same declaration path is resubmitted (final submit)', async () => {
      const storedPath = 'xvi-fc/state/x/2026-27/fc-unspent-declaration/fc-declaration/declaration.pdf';
      model['findOne'] = jest.fn().mockReturnValue(
        q({
          _id: parentOid,
          currentFormStatus: FORM_STATUS.NOT_STARTED,
          fcDeclaration: {
            originalName: 'declaration.pdf',
            path: storedPath,
            mimeType: 'application/pdf',
            extension: 'pdf',
            sizeKb: 100,
          },
        }),
      );
      const dto = baseDto({
        isFcUnspent: false,
        fcDeclaration: { originalName: 'declaration.pdf', path: storedPath, mimeType: 'application/pdf', sizeKb: 100 },
      });
      await service.finalSubmit(dto, stateUser(), '127.0.0.1', 'jest-agent');
      const setArg = getSetArg(model['findOneAndUpdate']);
      // Same-path case -> FileInfoNormalizerService returns `undefined`, so the caller omits
      // the field entirely from $set rather than re-including the existing object.
      expect(Object.prototype.hasOwnProperty.call(setArg, 'fcDeclaration')).toBe(false);
    });
  });

  // ─── Signed GET path never persisted ────────────────────────────────────────

  it('signs the declaration path for the GET response without writing anything back to the DB', async () => {
    const storedPath = 'xvi-fc/state/x/2026-27/fc-unspent-declaration/fc-declaration/declaration.pdf';
    model['findOne'] = jest.fn().mockReturnValue(
      q({
        _id: parentOid,
        currentFormStatus: FORM_STATUS.IN_PROGRESS,
        isFcUnspent: false,
        fcDeclaration: {
          originalName: 'declaration.pdf',
          path: storedPath,
          mimeType: 'application/pdf',
          extension: 'pdf',
          sizeKb: 100,
        },
      }),
    );
    const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
    const fileQuestion = result.data!.questions.find((q) => q.key === 'fcDeclaration')!;
    expect((fileQuestion.value as { path: string }).path).toBe(`signed::${storedPath}`);
    expect(model['findOneAndUpdate']).not.toHaveBeenCalled();
  });

  // ─── DB-backed formJson loading ─────────────────────────────────────────────

  describe('DB-backed formJson loading', () => {
    it('loads questions via FcUnspentDeclarationFormJsonService for GET, keyed by yearId', async () => {
      await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(formJsonConfigService['loadFields']).toHaveBeenCalledWith(yearOid.toString());
    });

    it('loads questions via FcUnspentDeclarationFormJsonService for saveDraft, keyed by dto.yearId', async () => {
      await service.saveDraft(baseDto({ isFcUnspent: null }), stateUser());
      expect(formJsonConfigService['loadFields']).toHaveBeenCalledWith(yearOid.toString());
    });

    it('loads questions via FcUnspentDeclarationFormJsonService for finalSubmit, keyed by dto.yearId', async () => {
      rowService['resolveAndValidateRows'] = jest.fn().mockResolvedValue({ rows: [sampleResolvedRow], errors: {} });
      await service.finalSubmit(
        baseDto({ isFcUnspent: true, checkboxConfirmation: true, unspentUlbData: [] }),
        stateUser(),
        '127.0.0.1',
        'jest-agent',
      );
      expect(formJsonConfigService['loadFields']).toHaveBeenCalledWith(yearOid.toString());
    });

    it('propagates a NotFoundException from the formJson loader instead of falling back to hardcoded questions (GET)', async () => {
      formJsonConfigService['loadFields'] = jest
        .fn()
        .mockRejectedValue(new NotFoundException('FormJson for year ... and formId 25 not found'));
      await expect(service.getForm(stateOid.toString(), yearOid.toString(), stateUser())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates a NotFoundException from the formJson loader instead of falling back to hardcoded questions (saveDraft)', async () => {
      formJsonConfigService['loadFields'] = jest.fn().mockRejectedValue(new NotFoundException('FormJson not found'));
      await expect(service.saveDraft(baseDto({ isFcUnspent: null }), stateUser())).rejects.toThrow(NotFoundException);
    });

    it('never imports the in-code question constant as a runtime fallback', () => {
      const source = readFileSync(join(__dirname, './fc-unspent-declaration.service.ts'), 'utf8');
      expect(source).not.toMatch(/FC_UNSPENT_STATE_QUESTIONS/);
      expect(source).not.toMatch(/fc-unspent-declaration\.form-json\.constant/);
    });
  });

  // ─── Declaration-template download ──────────────────────────────────────────

  describe('getDeclarationTemplate — configuration', () => {
    it('2026-27 resolves the exact approved template', () => {
      expect(FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27']).toEqual({
        path: 'xvi-fc/state/common/2026-27/fc-unspent/fc-declaration-template/FC-Unspent-Declaration_9ef58a73-82ef-43b7-991f-02257fcde890.docx',
        fileName: 'FC-Unspent-Declaration-2026-27.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    });

    it('does not fall back to the 2026-27 template for an unsupported design year', () => {
      expect(FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2027-28']).toBeUndefined();
      expect(FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['not-a-year']).toBeUndefined();
    });

    it('never returns the raw S3 path, only the signed url/fileName/mimeType', async () => {
      const result = await service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser());
      expect(result.data).toEqual({
        fileName: 'FC-Unspent-Declaration-2026-27.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        url: `signed::${FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27'].path}`,
      });
      // No extra keys (no raw `path`/`bucket`/token payload) beyond the 3 documented fields.
      expect(Object.keys(result.data!).sort()).toEqual(['fileName', 'mimeType', 'url']);
    });
  });

  describe('getDeclarationTemplate — access', () => {
    it('allows a STATE user to download for their own state', async () => {
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).resolves.toBeDefined();
    });

    it('blocks a STATE user from downloading for another state', async () => {
      await expect(
        service.getDeclarationTemplate(otherStateOid.toString(), yearOid.toString(), stateUser(stateOid)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN to download for any state', async () => {
      await expect(
        service.getDeclarationTemplate(otherStateOid.toString(), yearOid.toString(), adminUser),
      ).resolves.toBeDefined();
    });

    it('404s for a yearId that has no design-year label', async () => {
      const unknownYearId = new Types.ObjectId().toString();
      await expect(service.getDeclarationTemplate(stateOid.toString(), unknownYearId, stateUser())).rejects.toThrow(
        'Design year not found',
      );
    });
  });

  describe('getDeclarationTemplate — status/dependency gates (same canEdit as State GET)', () => {
    it('allows when the form is NOT_STARTED (missing parent)', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).resolves.toBeDefined();
    });

    it('allows when the form is IN_PROGRESS', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.IN_PROGRESS }));
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).resolves.toBeDefined();
    });

    it('allows when the form is RETURNED_BY_MOHUA', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA }));
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).resolves.toBeDefined();
    });

    it('blocks when the form is UNDER_REVIEW_BY_MOHUA', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks when the form is SUBMISSION_ACKNOWLEDGED_BY_MOHUA', async () => {
      model['findOne'] = jest
        .fn()
        .mockReturnValue(q({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }));
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks when the Devolution dependency gate fails (no Devolution form/dataset)', async () => {
      devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDeclarationTemplate — private signed download', () => {
    it('signs the exact full storage path via the existing FileTokenService (never a manually built URL)', async () => {
      const fileTokenService: { signFileUrl: jest.Mock } = (service as unknown as { fileTokenService: unknown })[
        'fileTokenService'
      ] as never;
      await service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser());
      expect(fileTokenService.signFileUrl).toHaveBeenCalledWith(
        FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27'].path,
      );
    });

    it('verifies the S3 object exists via the shared S3Service.headObject before signing', async () => {
      await service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser());
      expect(s3Service['headObject']).toHaveBeenCalledWith(FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27'].path);
    });

    it('fails without leaking the raw S3 error/key when headObject rejects (object missing)', async () => {
      s3Service['headObject'] = jest.fn().mockRejectedValue(new Error('NoSuchKey: some/internal/key.docx'));
      const message = await getValidationErrorMessage(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
        '_form',
      );
      expect(message).toBe('The declaration template could not be generated. Please contact support.');
      expect(message).not.toContain('NoSuchKey');
      expect(message).not.toContain(FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27'].path);
    });

    it('fails when the object metadata reports an empty file', async () => {
      s3Service['headObject'] = jest.fn().mockResolvedValue({ ContentLength: 0 });
      const message = await getValidationErrorMessage(
        service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
        '_form',
      );
      expect(message).toBe('The declaration template could not be generated. Please contact support.');
    });

    it("returns a controlled field error (not another year's file) when the design year has no configured template", async () => {
      // 2026-27 is the only configured year in this environment; simulate an unconfigured design
      // year by temporarily removing its mapping entry.
      const originalEntry = FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27'];
      delete (FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR as Record<string, unknown>)['2026-27'];
      try {
        const message = await getValidationErrorMessage(
          service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser()),
          'fcDeclaration',
        );
        expect(message).toBe('The declaration template is not configured for the selected design year.');
      } finally {
        FC_UNSPENT_DECLARATION_TEMPLATE_BY_YEAR['2026-27'] = originalEntry;
      }
    });

    it('does not write to the database (no parent update, no history, no row mutation)', async () => {
      await service.getDeclarationTemplate(stateOid.toString(), yearOid.toString(), stateUser());
      expect(model['findOneAndUpdate']).not.toHaveBeenCalled();
      expect(historyModel['create']).not.toHaveBeenCalled();
      expect(rowService['applyRows']).not.toHaveBeenCalled();
      expect(rowService['deactivateAllRows']).not.toHaveBeenCalled();
      expect(mockSession['startTransaction']).not.toHaveBeenCalled();
    });

    it('reuses signFileUrl rather than manually building the /file/download URL or duplicating token logic', () => {
      const source = readFileSync(join(__dirname, './fc-unspent-declaration.service.ts'), 'utf8');
      expect(source).toMatch(/signFileUrl\(template\.path\)/);
      expect(source).not.toMatch(/createToken\(/);
    });
  });

  describe('question hydration — download-template action', () => {
    it('is visible on GET when canEdit is true and the design year has a configured template', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.IN_PROGRESS }));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      const fcDeclaration = result.data!.questions.find((q) => q.key === 'fcDeclaration')!;
      const actionsBlock = fcDeclaration.supportingContent!.find((b) => b.type === 'actions')!;
      const action = actionsBlock.actions!.find((a) => a.id === FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID)!;
      expect(action.visible).toBe(true);
    });

    it('is hidden on GET when the form is read-only (canEdit false)', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      const fcDeclaration = result.data!.questions.find((q) => q.key === 'fcDeclaration')!;
      const actionsBlock = fcDeclaration.supportingContent!.find((b) => b.type === 'actions')!;
      const action = actionsBlock.actions!.find((a) => a.id === FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID)!;
      expect(action.visible).toBe(false);
    });

    it('is hidden when the design year has no configured template, even though canEdit is true', () => {
      const hydrated = (
        service as unknown as {
          hydrateQuestions: (
            questions: unknown[],
            savedData: Record<string, unknown>,
            ctx: unknown,
            canEdit: boolean,
            designYear: string,
          ) => Array<{
            key: string;
            supportingContent?: Array<{ type: string; actions?: Array<{ id: string; visible?: boolean }> }>;
          }>;
        }
      )['hydrateQuestions'](
        FC_UNSPENT_STATE_FORM_JSON.data,
        {},
        { _id: stateOid.toString(), role: 'state', designYear: '2026-27' },
        true,
        'unconfigured-design-year',
      );
      const fcDeclaration = hydrated.find((q) => q.key === 'fcDeclaration')!;
      const actionsBlock = fcDeclaration.supportingContent!.find((b) => b.type === 'actions')!;
      const action = actionsBlock.actions!.find((a) => a.id === FC_UNSPENT_DECLARATION_TEMPLATE_ACTION_ID)!;
      expect(action.visible).toBe(false);
    });

    it('never persists a signed URL into formJson — GET never writes to the database', async () => {
      await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(model['findOneAndUpdate']).not.toHaveBeenCalled();
    });
  });

  describe('question hydration — isFcUnspent info message', () => {
    const ISFCUNSPENT_INFO_MESSAGE =
      'Select No if your state has confirmed that none of its ULBs hold any unspent 14th Finance Commission balance. Select Yes if one or more ULBs need to report a balance.';

    it('shows the info message on GET when canEdit is true', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.IN_PROGRESS }));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      const isFcUnspent = result.data!.questions.find((q) => q.key === 'isFcUnspent')!;
      const infoBlock = isFcUnspent.supportingContent!.find((b) => b.type === 'info')!;
      expect(infoBlock.description).toBe(ISFCUNSPENT_INFO_MESSAGE);
    });

    it('removes the info block entirely on GET when the form is read-only (canEdit false) — not just blanks its description, since a present-but-empty block still renders an empty box', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      const isFcUnspent = result.data!.questions.find((q) => q.key === 'isFcUnspent')!;
      const infoBlock = isFcUnspent.supportingContent?.find((b) => b.type === 'info');
      expect(infoBlock).toBeUndefined();
    });

    it('never mutates formJson — GET never writes to the database', async () => {
      model['findOne'] = jest.fn().mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await service.getForm(stateOid.toString(), yearOid.toString(), stateUser());
      expect(model['findOneAndUpdate']).not.toHaveBeenCalled();
    });
  });

  // ─── Legacy collection never accessed ───────────────────────────────────────

  it('never references the legacy unspent-balance-disclosure collection', () => {
    const sources = [
      readFileSync(join(__dirname, '../../fc-unspent-declaration.module.ts'), 'utf8'),
      readFileSync(join(__dirname, './fc-unspent-declaration.service.ts'), 'utf8'),
      readFileSync(join(__dirname, '../rows/fc-unspent-declaration-row.service.ts'), 'utf8'),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/xvi_fc_unspent_balance_disclosures/);
      expect(source).not.toMatch(/UnspentBalanceDisclosure/);
    }
  });
});

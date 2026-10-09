import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DevolutionFormulaPmuReviewService } from './devolution-formula-pmu-review.service';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { DfFormJsonConfigService } from 'src/module/xvi-fc/state/devolution-formula/services/form-json/devolution-formula-form-json.service';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaFormHistory } from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { State } from 'src/schemas/state.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'populate', 'sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

/** `stateModel.find(...).sort().skip().limit().lean()` chain — a separate shape from `q()` since
 *  it resolves via `.lean()` directly, not `.exec()`. */
function qState<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['lean'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const userOid = new Types.ObjectId();
const formOid = new Types.ObjectId();

const pmuUser: AuthUser = { _id: userOid.toString(), scope: Scope.PMU, xviFcSubrole: 'admin' } as unknown as AuthUser;
const adminUser: AuthUser = { _id: userOid.toString(), scope: Scope.ADMIN } as unknown as AuthUser;
const stateUser: AuthUser = { _id: userOid.toString(), scope: Scope.STATE, state: stateOid } as unknown as AuthUser;

describe('DevolutionFormulaPmuReviewService', () => {
  let service: DevolutionFormulaPmuReviewService;
  let formModel: Record<string, jest.Mock>;
  let historyModel: Record<string, jest.Mock>;
  let rowModel: Record<string, jest.Mock>;
  let stateModel: { find: jest.Mock };
  let dfFormJsonConfigService: { loadFields: jest.Mock };

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(
        q({
          _id: formOid,
          state: stateOid,
          year: yearOid,
          installment: 1,
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          activeDatasetVersion: 1,
        }),
      ),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })),
      find: jest.fn().mockReturnValue(
        q([
          {
            state: stateOid,
            installment: 1,
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      ),
    };
    historyModel = { create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]) };
    rowModel = {
      find: jest.fn().mockReturnValue(
        q([
          {
            rowNumber: 1,
            censusCode: '111',
            ulbName: 'Alpha ULB',
            totalGrantAllocation: 1000,
            installment1Amount: 600,
            installment2Amount: 400,
            devolutionFormula: 'Population-based',
          },
        ]),
      ),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(1) }),
    };
    stateModel = { find: jest.fn().mockReturnValue(qState([{ _id: stateOid, name: 'Karnataka' }])) };
    const ulbModel = { countDocuments: jest.fn().mockResolvedValue(5) };
    dfFormJsonConfigService = {
      loadFields: jest.fn().mockResolvedValue([
        { key: 'ulbCount', label: 'Active ULBs', formFieldType: 'number', fieldTypes: ['DF_MAIN_FORM_FIELDS'] },
        {
          key: 'excelFile',
          label: 'Allocation Excel',
          formFieldType: 'file',
          fieldTypes: ['DF_MAIN_FORM_FIELDS'],
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaPmuReviewService,
        StateFormPmuReviewHelper,
        XvifcFormActorsService,
        FormQuestionHydratorService,
        FileInfoNormalizerService,
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        {
          provide: FileTokenService,
          useValue: { signFileUrlForSession: jest.fn().mockReturnValue('https://signed-url') },
        },
        { provide: DfFormJsonConfigService, useValue: dfFormJsonConfigService },
        { provide: UlbEligibilityService, useValue: { getEligibleUlbFilter: jest.fn().mockResolvedValue({}) } },
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: formModel },
        { provide: getModelToken(DevolutionFormulaFormHistory.name), useValue: historyModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: rowModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
      ],
    }).compile();

    service = module.get(DevolutionFormulaPmuReviewService);
  });

  describe('access control', () => {
    it('allows a PMU user', async () => {
      await expect(
        service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, pmuUser),
      ).resolves.toBeDefined();
    });

    it('allows an admin user', async () => {
      await expect(
        service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, adminUser),
      ).resolves.toBeDefined();
    });

    it('blocks a STATE user', async () => {
      await expect(service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, stateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getWorklist', () => {
    it('blocks a STATE user', async () => {
      await expect(service.getWorklist(yearOid.toString(), {}, stateUser)).rejects.toThrow(ForbiddenException);
    });

    it('returns the real status for the existing installment and synthesizes Not Started for the missing one', async () => {
      const result = await service.getWorklist(yearOid.toString(), {}, pmuUser);
      expect(result.data!.rows).toEqual([
        {
          stateId: stateOid.toString(),
          stateName: 'Karnataka',
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          currentFormStatusLabel: expect.any(String),
          updatedAt: '2026-01-01T00:00:00.000Z',
          installment: 1,
        },
        {
          stateId: stateOid.toString(),
          stateName: 'Karnataka',
          currentFormStatus: FORM_STATUS.NOT_STARTED,
          currentFormStatusLabel: expect.any(String),
          updatedAt: null,
          installment: 2,
        },
      ]);
    });

    it('synthesizes both installments as Not Started for an active+published state with no document at all', async () => {
      formModel['find'] = jest.fn().mockReturnValue(q([]));
      const result = await service.getWorklist(yearOid.toString(), {}, pmuUser);
      expect(result.data!.rows).toEqual([
        {
          stateId: stateOid.toString(),
          stateName: 'Karnataka',
          currentFormStatus: FORM_STATUS.NOT_STARTED,
          currentFormStatusLabel: expect.any(String),
          updatedAt: null,
          installment: 1,
        },
        {
          stateId: stateOid.toString(),
          stateName: 'Karnataka',
          currentFormStatus: FORM_STATUS.NOT_STARTED,
          currentFormStatusLabel: expect.any(String),
          updatedAt: null,
          installment: 2,
        },
      ]);
    });

    it('queries the State collection filtered to isActive+isPublish+isUT:false, sorted by name', async () => {
      await service.getWorklist(yearOid.toString(), {}, pmuUser);
      expect(stateModel.find).toHaveBeenCalledWith({ isActive: true, isPublish: true, isUT: false }, { name: 1 });
    });

    it('no longer filters the form query by status or installment', async () => {
      await service.getWorklist(yearOid.toString(), {}, pmuUser);
      const filter = formModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(filter).not.toHaveProperty('currentFormStatus');
      expect(filter).not.toHaveProperty('installment');
    });
  });

  describe('getReviewMetadata', () => {
    it('404s when no form exists for the state/year/installment', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, pmuUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows read-only review of a form that has never reached PMU (e.g. IN_PROGRESS) — view-only, not mutable', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.IN_PROGRESS }));
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, pmuUser);
      expect(result.data!.permissions.canView).toBe(true);
      expect(result.data!.permissions.canApproveForm).toBe(false);
      expect(result.data!.permissions.canRejectForm).toBe(false);
    });

    it('surfaces a previously-stored pmuRemarks (e.g. while RETURNED_BY_PMU), null when absent', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(
          q({ _id: formOid, currentFormStatus: FORM_STATUS.RETURNED_BY_PMU, pmuRemarks: 'Please redo section 2.' }),
        );
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, pmuUser);
      expect(result.data!.pmuRemarks).toBe('Please redo section 2.');

      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU }));
      const result2 = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, pmuUser);
      expect(result2.data!.pmuRemarks).toBeNull();
    });

    it('includes the installment in the response', async () => {
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 2, pmuUser);
      expect(result.data!.installment).toBe(2);
    });

    it('surfaces the true checkboxConfirmation value — regression test for a bug where PMU always saw "Not certified" regardless of what State submitted', async () => {
      dfFormJsonConfigService['loadFields'].mockResolvedValueOnce([
        { key: 'ulbCount', label: 'Active ULBs', formFieldType: 'number', fieldTypes: ['DF_MAIN_FORM_FIELDS'] },
        {
          key: 'excelFile',
          label: 'Allocation Excel',
          formFieldType: 'file',
          fieldTypes: ['DF_MAIN_FORM_FIELDS'],
        },
        {
          key: 'checkboxConfirmation',
          label: 'I confirm the submission is accurate.',
          formFieldType: 'checkbox',
          fieldTypes: ['DF_MAIN_FORM_FIELDS'],
          value: false,
        },
      ]);
      formModel['findOne'] = jest.fn().mockReturnValue(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          checkboxConfirmation: true,
        }),
      );

      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), 1, pmuUser);

      const checkboxQuestion = result.data!.questions?.find((q) => q.key === 'checkboxConfirmation');
      expect(checkboxQuestion?.value).toBe(true);
    });
  });

  describe('getRows', () => {
    it('blocks a STATE user', async () => {
      await expect(service.getRows(stateOid.toString(), yearOid.toString(), 1, {}, stateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s when no form exists for the state/year/installment', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(service.getRows(stateOid.toString(), yearOid.toString(), 1, {}, pmuUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks when the form status is not PMU-reviewable', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(
          q({ _id: formOid, currentFormStatus: FORM_STATUS.EXEMPTED_ACKNOWLEDGED, activeDatasetVersion: 1 }),
        );
      await expect(service.getRows(stateOid.toString(), yearOid.toString(), 1, {}, pmuUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the read-only ULB-wise allocation rows, scoped to the active dataset version, with pagination meta', async () => {
      const result = await service.getRows(stateOid.toString(), yearOid.toString(), 1, {}, pmuUser);
      expect(result.data!.rows).toEqual([
        {
          rowNumber: 1,
          censusCode: '111',
          ulbName: 'Alpha ULB',
          totalGrantAllocation: 1000,
          installment1Amount: 600,
          installment2Amount: 400,
          devolutionFormula: 'Population-based',
        },
      ]);
      expect(rowModel['find']).toHaveBeenCalledWith({ form: formOid, datasetVersion: 1, isActive: true });
      expect(rowModel['countDocuments']).toHaveBeenCalledWith({ form: formOid, datasetVersion: 1, isActive: true });
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    });

    it('applies page/limit from the query, within the caller-visible skip/limit chain', async () => {
      const findChain = q([]);
      rowModel['find'] = jest.fn().mockReturnValue(findChain);
      await service.getRows(stateOid.toString(), yearOid.toString(), 1, { page: 2, limit: 10 }, pmuUser);
      expect(findChain['skip']).toHaveBeenCalledWith(10);
      expect(findChain['limit']).toHaveBeenCalledWith(10);
    });
  });

  describe('approveCompleteForm', () => {
    it('404s when the form does not exist', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), 1, pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks mutation when the form is not UNDER_REVIEW_BY_PMU', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), 1, pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('transitions the form to UNDER_REVIEW_BY_MOHUA and writes a PMU_APPROVE history row with no row snapshot', async () => {
      const result = await service.approveCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        1,
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      const call = formModel['findOneAndUpdate'].mock.calls[0] as unknown[];
      const setArg = (call[1] as { $set: Record<string, unknown> }).$set;
      expect(setArg['currentFormStatus']).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

      expect(historyModel['create']).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            action: FormHistoryAction.PMU_APPROVE,
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          }),
        ],
        undefined,
      );
      // Devolution's PMU reviewer never touches row data (whole-form only, per Part F) — no
      // `snapshot` key means the history schema's own `default: null` applies.
      const historyDoc = (historyModel['create'].mock.calls[0] as unknown[])[0] as Array<Record<string, unknown>>;
      expect(historyDoc[0]).not.toHaveProperty('snapshot');
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });
  });

  describe('rejectCompleteForm', () => {
    it('requires a non-empty pmuRemarks', async () => {
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 1, '   ', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks mutation when the form is already approved', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.rejectCompleteForm(
          stateOid.toString(),
          yearOid.toString(),
          1,
          'Fix this.',
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('transitions to RETURNED_BY_PMU, stores pmuRemarks, and writes a PMU_REJECT history row', async () => {
      const result = await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        1,
        'Please redo.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      const call = formModel['findOneAndUpdate'].mock.calls[0] as unknown[];
      const setArg = (call[1] as { $set: Record<string, unknown> }).$set;
      expect(setArg).toMatchObject({ currentFormStatus: FORM_STATUS.RETURNED_BY_PMU, pmuRemarks: 'Please redo.' });

      expect(historyModel['create']).toHaveBeenCalledWith(
        [expect.objectContaining({ action: FormHistoryAction.PMU_REJECT, remarks: 'Please redo.' })],
        undefined,
      );
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.RETURNED_BY_PMU);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesPmuReviewService } from './elected-urban-local-bodies-pmu-review.service';
import { ElectedUrbanLocalBodiesPmuRowReviewDomainService } from './elected-urban-local-bodies-pmu-row-review-domain.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { State } from 'src/schemas/state.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { EulbPmuFormLean, EulbPmuRowLean } from '../types/elected-urban-local-bodies-pmu-review.types';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'populate']) {
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
const ulbOid1 = new Types.ObjectId();

const pmuUser: AuthUser = {
  _id: userOid.toString(),
  scope: Scope.PMU,
  xviFcSubrole: 'admin',
} as unknown as AuthUser;
const adminUser: AuthUser = { _id: userOid.toString(), scope: Scope.ADMIN } as unknown as AuthUser;
const stateUser: AuthUser = { _id: userOid.toString(), scope: Scope.STATE, state: stateOid } as unknown as AuthUser;

function makeForm(overrides: Partial<EulbPmuFormLean> = {}): EulbPmuFormLean {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    activeDatasetVersion: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<EulbPmuRowLean> = {}): EulbPmuRowLean {
  return {
    _id: new Types.ObjectId(),
    form: formOid,
    datasetVersion: 1,
    rowNumber: 1,
    ulbId: ulbOid1,
    censusCode: '111',
    ulbName: 'Alpha ULB',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-01-01T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-01-01T00:00:00.000Z'),
    remarks: null,
    rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    rejectionRemark: null,
    ...overrides,
  };
}

describe('ElectedUrbanLocalBodiesPmuReviewService', () => {
  let service: ElectedUrbanLocalBodiesPmuReviewService;
  let formModel: Record<string, jest.Mock>;
  let domainService: Record<string, jest.Mock>;
  let mockSession: Record<string, jest.Mock>;
  let stateModel: { find: jest.Mock };

  beforeEach(async () => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    formModel = {
      findOne: jest
        .fn()
        .mockReturnValue(
          q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, activeDatasetVersion: 1 }),
        ),
      find: jest.fn().mockReturnValue(
        q([
          {
            state: stateOid,
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      ),
      db: { startSession: jest.fn().mockResolvedValue(mockSession) } as unknown as Record<string, jest.Mock>,
    };
    stateModel = { find: jest.fn().mockReturnValue(qState([{ _id: stateOid, name: 'Karnataka' }])) };
    const ulbModel = { countDocuments: jest.fn().mockResolvedValue(5) };
    domainService = {
      findForm: jest.fn().mockResolvedValue(makeForm()),
      getActiveRows: jest.fn().mockResolvedValue([]),
      getRowSummary: jest
        .fn()
        .mockResolvedValue({ total: 0, active: 0, updatePending: 0, rejected: 0, needsUpdate: 0 }),
      transitionRows: jest.fn().mockResolvedValue(undefined),
      transitionParent: jest.fn().mockResolvedValue(undefined),
      insertParentHistory: jest.fn().mockResolvedValue(undefined),
      maybeApproveAfterBulkAction: jest
        .fn()
        .mockResolvedValue({ approved: true, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesPmuReviewService,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: formModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: ElectedUrbanLocalBodiesPmuRowReviewDomainService, useValue: domainService },
        XvifcFormActorsService,
        FormQuestionHydratorService,
        FileInfoNormalizerService,
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        {
          provide: FileTokenService,
          useValue: { signFileUrlForSession: jest.fn().mockReturnValue('https://signed-url') },
        },
        {
          provide: EulbFormJsonConfigService,
          useValue: {
            loadFields: jest.fn().mockResolvedValue([
              {
                key: 'checkboxConfirmation',
                label: 'Confirm',
                formFieldType: 'checkbox',
                fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
              },
              { key: 'ulbCount', label: 'ULB Count', formFieldType: 'number', fieldTypes: ['EULB_MAIN_FORM_FIELDS'] },
            ]),
          },
        },
        { provide: UlbEligibilityService, useValue: { getEligibleUlbFilter: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesPmuReviewService);
  });

  // ─── Access control ─────────────────────────────────────────────────────────

  describe('access control', () => {
    it('allows a PMU user', async () => {
      await expect(service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser)).resolves.toBeDefined();
    });

    it('allows an admin user', async () => {
      await expect(
        service.getReviewMetadata(stateOid.toString(), yearOid.toString(), adminUser),
      ).resolves.toBeDefined();
    });

    it('blocks a STATE user', async () => {
      await expect(service.getReviewMetadata(stateOid.toString(), yearOid.toString(), stateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── getWorklist ────────────────────────────────────────────────────────────

  describe('getWorklist', () => {
    it('blocks a STATE user', async () => {
      await expect(service.getWorklist(yearOid.toString(), stateUser)).rejects.toThrow(ForbiddenException);
    });

    it('returns the real status/label for an active+published state with a document', async () => {
      const result = await service.getWorklist(yearOid.toString(), pmuUser);
      expect(result.data!.rows).toEqual([
        {
          stateId: stateOid.toString(),
          stateName: 'Karnataka',
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          currentFormStatusLabel: expect.any(String),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('synthesizes a Not Started row, updatedAt null, for an active+published state with no document at all', async () => {
      const otherStateOid = new Types.ObjectId();
      stateModel.find.mockReturnValue(qState([{ _id: otherStateOid, name: 'Kerala' }]));
      const result = await service.getWorklist(yearOid.toString(), pmuUser);
      expect(result.data!.rows).toEqual([
        {
          stateId: otherStateOid.toString(),
          stateName: 'Kerala',
          currentFormStatus: FORM_STATUS.NOT_STARTED,
          currentFormStatusLabel: expect.any(String),
          updatedAt: null,
        },
      ]);
    });

    it('queries the State collection filtered to isActive+isPublish+isUT:false, sorted by name', async () => {
      await service.getWorklist(yearOid.toString(), pmuUser);
      expect(stateModel.find).toHaveBeenCalledWith({ isActive: true, isPublish: true, isUT: false }, { name: 1 });
    });

    it('no longer filters the form query by status — every existing document is left-joined regardless of status', async () => {
      await service.getWorklist(yearOid.toString(), pmuUser);
      const filter = formModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(filter).not.toHaveProperty('currentFormStatus');
    });
  });

  // ─── getReviewMetadata ──────────────────────────────────────────────────────

  describe('getReviewMetadata', () => {
    it('404s when no form exists for the state/year', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows read-only review of a form that has never reached PMU (e.g. IN_PROGRESS) — view-only, not mutable', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.IN_PROGRESS }));
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
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
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.pmuRemarks).toBe('Please redo section 2.');

      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU }));
      const result2 = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result2.data!.pmuRemarks).toBeNull();
    });

    it('surfaces the stored validationStatus, falling back to NOT_VALIDATED when absent', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(
          q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, validationStatus: 'VALID' }),
        );
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.validationStatus).toBe('VALID');

      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU }));
      const result2 = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result2.data!.validationStatus).toBe('NOT_VALIDATED');
    });

    it('remains viewable once approved', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(
          q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, activeDatasetVersion: 1 }),
        );
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('fetches the row summary from the domain service', async () => {
      domainService['getRowSummary'] = jest
        .fn()
        .mockResolvedValue({ total: 2, active: 1, updatePending: 1, rejected: 0, needsUpdate: 0 });
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.rowSummary.total).toBe(2);
      expect(domainService['getRowSummary']).toHaveBeenCalledWith(formOid, 1);
    });

    it('grants canApproveForm/canRejectForm/canReviewRows only for an admin-subrole PMU user on a mutable form', async () => {
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.permissions).toEqual({
        canView: true,
        canApproveForm: true,
        canRejectForm: true,
        canReviewRows: true,
      });
    });

    it('withholds mutation permissions for a reviewer-subrole PMU user (REVIEW_STATE_SUBMISSIONS_PMU only)', async () => {
      const reviewerUser = {
        _id: userOid.toString(),
        scope: Scope.PMU,
        xviFcSubrole: 'reviewer',
      } as unknown as AuthUser;
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), reviewerUser);
      expect(result.data!.permissions).toEqual({
        canView: true,
        canApproveForm: false,
        canRejectForm: false,
        canReviewRows: false,
      });
    });

    it('withholds mutation permissions once the form is approved (settled terminal state for this stage)', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(
          q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, activeDatasetVersion: 1 }),
        );
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.permissions.canView).toBe(true);
      expect(result.data!.permissions.canApproveForm).toBe(false);
      expect(result.data!.permissions.canRejectForm).toBe(false);
    });
  });

  // ─── approveCompleteForm ────────────────────────────────────────────────────

  describe('approveCompleteForm', () => {
    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks mutation when the form is not UNDER_REVIEW_BY_PMU (approved terminal gate)', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks when there are zero active rows', async () => {
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks when any active row is REJECTED', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.RETURNED_BY_PMU })]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks when any active row has null rowStatus', async () => {
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([makeRow({ rowStatus: null })]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions only PENDING rows to APPROVED, leaves already-APPROVED rows untouched', async () => {
      const pending = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      const approved = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([pending, approved]);

      await service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest');

      const transitionCallArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionCallArgs[3] as Array<{ row: EulbPmuRowLean }>;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].row._id).toEqual(pending._id);
    });

    it('settles the parent via maybeApproveAfterBulkAction atomically', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU })]);

      const result = await service.approveCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['maybeApproveAfterBulkAction']).toHaveBeenCalledWith(
        expect.objectContaining({ _id: formOid }),
        userOid,
        '127.0.0.1',
        'jest',
        mockSession,
      );
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU })]);
      domainService['maybeApproveAfterBulkAction'] = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });
  });

  // ─── rejectCompleteForm ─────────────────────────────────────────────────────

  describe('rejectCompleteForm', () => {
    it('requires a non-empty pmuRemarks', async () => {
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), '   ', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks mutation when the form is already approved', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 'Fix this.', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks when any active row has already been approved', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })]);
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 'Fix this.', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects remaining PENDING rows with the shared remark, leaves already-REJECTED rows untouched', async () => {
      const pending = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      const rejected = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.RETURNED_BY_PMU });
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([pending, rejected]);

      await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        'Dates inconsistent with registry.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      const transitionCallArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionCallArgs[3] as Array<{ row: EulbPmuRowLean; rejectionRemark: string }>;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].row._id).toEqual(pending._id);
      expect(transitions[0].rejectionRemark).toBe('Dates inconsistent with registry.');
    });

    it('transitions the parent to RETURNED_BY_PMU and writes PMU_REJECT history atomically', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU })]);

      const result = await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        'Fix this.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['transitionParent']).toHaveBeenCalledWith(
        formOid,
        FORM_STATUS.RETURNED_BY_PMU,
        'Fix this.',
        userOid,
        mockSession,
      );
      expect(domainService['insertParentHistory']).toHaveBeenCalledWith(
        expect.objectContaining({ _id: formOid }),
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        FORM_STATUS.RETURNED_BY_PMU,
        FormHistoryAction.PMU_REJECT,
        userOid,
        '127.0.0.1',
        'jest',
        mockSession,
      );
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.RETURNED_BY_PMU);
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      domainService['transitionParent'] = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 'Fix this.', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });
  });
});

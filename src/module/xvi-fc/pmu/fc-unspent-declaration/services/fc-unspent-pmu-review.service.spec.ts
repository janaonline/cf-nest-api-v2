import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FcUnspentPmuReviewService } from './fc-unspent-pmu-review.service';
import { FcUnspentPmuRowReviewDomainService } from './fc-unspent-pmu-row-review-domain.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FcUnspentDeclarationFormJsonService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/form-json/fc-unspent-declaration-form-json.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { XviFcUnspentStateForm } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { State } from 'src/schemas/state.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { FcUnspentPmuFormLean, FcUnspentPmuRowLean } from '../types/fc-unspent-pmu-review.types';

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

const YEAR_2026_27 = '67d7d136d3d038946a5239e9';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId(YEAR_2026_27);
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

function makeForm(overrides: Partial<FcUnspentPmuFormLean> = {}): FcUnspentPmuFormLean {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    isFcUnspent: true,
    fcDeclaration: null,
    checkboxConfirmation: true,
    auditRevision: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<FcUnspentPmuRowLean> = {}): FcUnspentPmuRowLean {
  return {
    _id: new Types.ObjectId(),
    form: formOid,
    rowNumber: 1,
    ulbId: ulbOid1,
    censusCode: '111',
    sbCode: 'A1',
    ulbName: 'Alpha ULB',
    allocationAmount: 100,
    unspentAmount: 5,
    previousFcUnspentBalance: 3,
    allocationPerc: 5,
    eligibility: true,
    rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    rejectionRemark: null,
    ...overrides,
  };
}

describe('FcUnspentPmuReviewService', () => {
  let service: FcUnspentPmuReviewService;
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
      findOne: jest.fn().mockReturnValue(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          isFcUnspent: true,
          fcDeclaration: null,
          checkboxConfirmation: true,
        }),
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
    domainService = {
      findForm: jest.fn().mockResolvedValue(makeForm()),
      getActiveRows: jest.fn().mockResolvedValue([]),
      getRowSummary: jest.fn().mockResolvedValue({
        total: 0,
        active: 0,
        updatePending: 0,
        rejected: 0,
        needsUpdate: 0,
        eligible: 0,
        ineligible: 0,
      }),
      transitionRows: jest.fn().mockResolvedValue(undefined),
      transitionParent: jest.fn().mockResolvedValue(undefined),
      insertParentHistory: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentPmuReviewService,
        { provide: getModelToken(XviFcUnspentStateForm.name), useValue: formModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: FcUnspentPmuRowReviewDomainService, useValue: domainService },
        XvifcFormActorsService,
        FileInfoNormalizerService,
        FormQuestionHydratorService,
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        {
          provide: FileTokenService,
          useValue: {
            signFileUrl: jest.fn((p: string) => `signed::${p}`),
            signFileUrlForSession: jest.fn((p: string) => `signed::${p}`),
          },
        },
        {
          provide: FcUnspentDeclarationFormJsonService,
          useValue: {
            loadFormConfig: jest.fn().mockResolvedValue({
              fields: [
                {
                  key: 'isFcUnspent',
                  label: 'Is FC Unspent?',
                  formFieldType: 'radio',
                  fieldTypes: ['FC_UNSPENT_MAIN_FORM_FIELDS'],
                },
              ],
              thresholdPercent: 10,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(FcUnspentPmuReviewService);
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

  // ─── getReviewMetadata ──────────────────────────────────────────────────────

  describe('getWorklist', () => {
    it('blocks a STATE user', async () => {
      await expect(service.getWorklist(yearOid.toString(), {}, stateUser)).rejects.toThrow(ForbiddenException);
    });

    it('returns the real status/label for an active+published state with a document', async () => {
      const result = await service.getWorklist(yearOid.toString(), {}, pmuUser);
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
      const result = await service.getWorklist(yearOid.toString(), {}, pmuUser);
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
      await service.getWorklist(yearOid.toString(), {}, pmuUser);
      expect(stateModel.find).toHaveBeenCalledWith({ isActive: true, isPublish: true, isUT: false }, { name: 1 });
    });

    it('keeps the isDeleted:false filter, but no longer filters the form query by status', async () => {
      await service.getWorklist(yearOid.toString(), {}, pmuUser);
      const filter = formModel['find'].mock.calls[0][0] as Record<string, unknown>;
      expect(filter).toMatchObject({ isDeleted: false });
      expect(filter).not.toHaveProperty('currentFormStatus');
    });
  });

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
      formModel['findOne'] = jest.fn().mockReturnValue(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.RETURNED_BY_PMU,
          isFcUnspent: true,
          pmuRemarks: 'Please redo section 2.',
        }),
      );
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.pmuRemarks).toBe('Please redo section 2.');

      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, isFcUnspent: true }));
      const result2 = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result2.data!.pmuRemarks).toBeNull();
    });

    it('remains viewable once approved', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, isFcUnspent: true }));
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('returns a zero row summary for a No-branch form', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, isFcUnspent: false }));
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.rowSummary).toEqual({
        total: 0,
        active: 0,
        updatePending: 0,
        rejected: 0,
        needsUpdate: 0,
        eligible: 0,
        ineligible: 0,
      });
      expect(domainService['getRowSummary']).not.toHaveBeenCalled();
    });

    it('fetches the row summary for a Yes-branch form', async () => {
      domainService['getRowSummary'] = jest.fn().mockResolvedValue({
        total: 2,
        active: 1,
        updatePending: 1,
        rejected: 0,
        needsUpdate: 0,
        eligible: 2,
        ineligible: 0,
      });
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.rowSummary.total).toBe(2);
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
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, isFcUnspent: true }));
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.permissions.canView).toBe(true);
      expect(result.data!.permissions.canApproveForm).toBe(false);
      expect(result.data!.permissions.canRejectForm).toBe(false);
    });

    it('signs the fcDeclaration path for response only', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(
        q({
          _id: formOid,
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          isFcUnspent: false,
          fcDeclaration: { path: 'fc-unspent/declaration.pdf', originalName: 'declaration.pdf' },
        }),
      );
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect((result.data!.fcDeclaration as { path: string }).path).toBe('signed::fc-unspent/declaration.pdf');
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

    it('No-branch: blocks approval when the persisted declaration is missing', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(makeForm({ isFcUnspent: false, fcDeclaration: null }));
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('No-branch: approves directly with no row transitions', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ isFcUnspent: false, fcDeclaration: { path: 'x.pdf' } }));

      const result = await service.approveCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['transitionRows']).not.toHaveBeenCalled();
      expect(domainService['transitionParent']).toHaveBeenCalledWith(
        formOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        undefined,
        2,
        userOid,
        mockSession,
      );
      expect(domainService['insertParentHistory']).toHaveBeenCalled();
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('Yes-branch: blocks when there are zero active rows', async () => {
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Yes-branch: blocks when any active row is REJECTED', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.RETURNED_BY_PMU })]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Yes-branch: blocks when any active row is NEEDS_UPDATE', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.ACTION_REQUIRED })]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Yes-branch: blocks when any active row has null rowStatus', async () => {
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([makeRow({ rowStatus: null })]);
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Yes-branch: transitions only PENDING rows to APPROVED, leaves already-APPROVED rows untouched', async () => {
      const pending = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      const approved = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([pending, approved]);

      await service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest');

      const transitionCallArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionCallArgs[3] as Array<{ row: FcUnspentPmuRowLean }>;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].row._id).toEqual(pending._id);
    });

    it('Yes-branch: approves the parent and writes parent history atomically', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU })]);

      await service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest');

      expect(domainService['transitionParent']).toHaveBeenCalledWith(
        formOid,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        undefined,
        2,
        userOid,
        mockSession,
      );
      expect(domainService['insertParentHistory']).toHaveBeenCalled();
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU })]);
      domainService['transitionParent'] = jest.fn().mockRejectedValue(new Error('db error'));

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

    it('No-branch: returns to RETURNED_BY_PMU and stores pmuRemarks', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(makeForm({ isFcUnspent: false }));

      const result = await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        'Please redo the declaration.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['transitionParent']).toHaveBeenCalledWith(
        formOid,
        FORM_STATUS.RETURNED_BY_PMU,
        'Please redo the declaration.',
        2,
        userOid,
        mockSession,
      );
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.RETURNED_BY_PMU);
    });

    it('Yes-branch: blocks when any active row has already been approved', async () => {
      domainService['getActiveRows'] = jest
        .fn()
        .mockResolvedValue([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })]);
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 'Fix this.', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Yes-branch: rejects remaining PENDING rows with the shared remark, leaves already-REJECTED rows untouched', async () => {
      const pending = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      const rejected = makeRow({ _id: new Types.ObjectId(), rowStatus: FORM_STATUS.RETURNED_BY_PMU });
      domainService['getActiveRows'] = jest.fn().mockResolvedValue([pending, rejected]);

      await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        'Allocation mismatch.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      const transitionCallArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionCallArgs[3] as Array<{ row: FcUnspentPmuRowLean; rejectionRemark: string }>;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].row._id).toEqual(pending._id);
      expect(transitions[0].rejectionRemark).toBe('Allocation mismatch.');
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      domainService['transitionParent'] = jest.fn().mockRejectedValue(new Error('db error'));
      domainService['findForm'] = jest.fn().mockResolvedValue(makeForm({ isFcUnspent: false }));

      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 'Fix this.', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });
  });
});

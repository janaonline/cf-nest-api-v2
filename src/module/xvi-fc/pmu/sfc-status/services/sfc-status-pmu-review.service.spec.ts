import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SfcStatusPmuReviewService } from './sfc-status-pmu-review.service';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { XviFcSfcStatusHistory } from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { State } from 'src/schemas/state.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'populate']) {
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

describe('SfcStatusPmuReviewService', () => {
  let service: SfcStatusPmuReviewService;
  let formModel: Record<string, jest.Mock>;
  let historyModel: Record<string, jest.Mock>;
  let stateModel: { find: jest.Mock };

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(
        q({
          _id: formOid,
          state: stateOid,
          year: yearOid,
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
          data: { sfcStatus: 'active' },
        }),
      ),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })),
      find: jest.fn().mockReturnValue(
        q([
          {
            state: stateOid,
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      ),
    };
    historyModel = { create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]) };
    stateModel = { find: jest.fn().mockReturnValue(qState([{ _id: stateOid, name: 'Karnataka' }])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SfcStatusPmuReviewService,
        StateFormPmuReviewHelper,
        XvifcFormActorsService,
        FormQuestionHydratorService,
        FileInfoNormalizerService,
        { provide: FileUrlNormalizerService, useValue: { toRawStoragePath: jest.fn((v: string) => v) } },
        {
          provide: FileTokenService,
          useValue: { signFileUrlForSession: jest.fn().mockReturnValue('https://signed-url') },
        },
        {
          provide: FormJsonService,
          useValue: {
            findActiveByDesignYearAndFormId: jest
              .fn()
              .mockResolvedValue({ data: [{ key: 'sfcStatus', label: 'SFC Status', formFieldType: 'radio' }] }),
          },
        },
        { provide: getModelToken(XviFcSfcStatus.name), useValue: formModel },
        { provide: getModelToken(XviFcSfcStatusHistory.name), useValue: historyModel },
        { provide: getModelToken(State.name), useValue: stateModel },
      ],
    }).compile();

    service = module.get(SfcStatusPmuReviewService);
  });

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

    it('remains viewable once approved (PMU has no status of its own — lands on UNDER_REVIEW_BY_MOHUA)', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('grants canApproveForm/canRejectForm only for an admin-subrole PMU user on a mutable form', async () => {
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), pmuUser);
      expect(result.data!.permissions).toEqual({ canView: true, canApproveForm: true, canRejectForm: true });
    });

    it('withholds mutation permissions for a reviewer-subrole PMU user', async () => {
      const reviewerUser = {
        _id: userOid.toString(),
        scope: Scope.PMU,
        xviFcSubrole: 'reviewer',
      } as unknown as AuthUser;
      const result = await service.getReviewMetadata(stateOid.toString(), yearOid.toString(), reviewerUser);
      expect(result.data!.permissions).toEqual({ canView: true, canApproveForm: false, canRejectForm: false });
    });
  });

  describe('approveCompleteForm', () => {
    it('404s when the form does not exist', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q(null));
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks mutation when the form is not UNDER_REVIEW_BY_PMU', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('transitions the form to UNDER_REVIEW_BY_MOHUA via findOneAndUpdate', async () => {
      await service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest');
      const call = formModel['findOneAndUpdate'].mock.calls[0] as unknown[];
      const setArg = (call[1] as { $set: Record<string, unknown> }).$set;
      expect(setArg['currentFormStatus']).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('writes a PMU_APPROVE history row snapshotting the form data, non-transactionally', async () => {
      await service.approveCompleteForm(stateOid.toString(), yearOid.toString(), pmuUser, '127.0.0.1', 'jest');
      expect(historyModel['create']).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            action: FormHistoryAction.PMU_APPROVE,
            fromStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
            metadata: { sfcStatus: 'active' },
          }),
        ],
        undefined,
      );
    });

    it('returns the new status in the response', async () => {
      const result = await service.approveCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        pmuUser,
        '127.0.0.1',
        'jest',
      );
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });
  });

  describe('rejectCompleteForm', () => {
    it('requires a non-empty pmuRemarks', async () => {
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), '   ', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks mutation when the form is already approved', async () => {
      formModel['findOne'] = jest
        .fn()
        .mockReturnValue(q({ _id: formOid, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(
        service.rejectCompleteForm(stateOid.toString(), yearOid.toString(), 'Fix this.', pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('transitions to RETURNED_BY_PMU and stores pmuRemarks', async () => {
      const result = await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        'Please redo the figures.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      const call = formModel['findOneAndUpdate'].mock.calls[0] as unknown[];
      const setArg = (call[1] as { $set: Record<string, unknown> }).$set;
      expect(setArg).toMatchObject({
        currentFormStatus: FORM_STATUS.RETURNED_BY_PMU,
        pmuRemarks: 'Please redo the figures.',
      });
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.RETURNED_BY_PMU);
    });

    it('writes a PMU_REJECT history row with the remark and data snapshot', async () => {
      await service.rejectCompleteForm(
        stateOid.toString(),
        yearOid.toString(),
        'Fix this.',
        pmuUser,
        '127.0.0.1',
        'jest',
      );
      expect(historyModel['create']).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            action: FormHistoryAction.PMU_REJECT,
            toStatus: FORM_STATUS.RETURNED_BY_PMU,
            remarks: 'Fix this.',
            metadata: { sfcStatus: 'active' },
          }),
        ],
        undefined,
      );
    });
  });
});

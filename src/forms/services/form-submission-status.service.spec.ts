import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FormSubmissionStatusService } from './form-submission-status.service';
import { FormSubmission } from '../schemas/form-submission.schema';
import { FormStatusHistory } from '../schemas/form-status-history.schema';
import { FORM_STATUS } from '../../common/constants/form-status.constants';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../../module/auth/enum/role.enum';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['session', 'sort', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('FormSubmissionStatusService', () => {
  let service: FormSubmissionStatusService;
  let formSubmissionModel: { findById: jest.Mock; findByIdAndUpdate: jest.Mock };
  let formStatusHistoryModel: { create: jest.Mock; find: jest.Mock };

  const formSubmissionId = new Types.ObjectId().toString();
  const ulbId = new Types.ObjectId();
  const stateId = new Types.ObjectId();

  const ulbActor: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ULB, ulb: ulbId.toString() };

  beforeEach(async () => {
    formSubmissionModel = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
    formStatusHistoryModel = { create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormSubmissionStatusService,
        { provide: getModelToken(FormSubmission.name), useValue: formSubmissionModel },
        { provide: getModelToken(FormStatusHistory.name), useValue: formStatusHistoryModel },
      ],
    }).compile();

    service = module.get<FormSubmissionStatusService>(FormSubmissionStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateFormStatus', () => {
    it('throws NotFoundException when the submission does not exist', async () => {
      formSubmissionModel.findById.mockReturnValue(q(null));

      await expect(
        service.updateFormStatus(formSubmissionId, FORM_STATUS.IN_PROGRESS, ulbActor, 'SAVE_DRAFT'),
      ).rejects.toThrow(NotFoundException);
      expect(formSubmissionModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an invalid transition and does not touch the DB', async () => {
      formSubmissionModel.findById.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.NOT_STARTED, ulbId, stateId }),
      );

      await expect(
        service.updateFormStatus(formSubmissionId, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, ulbActor, 'SKIP'),
      ).rejects.toThrow(BadRequestException);
      expect(formSubmissionModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(formStatusHistoryModel.create).not.toHaveBeenCalled();
    });

    it('skips transition validation entirely when fromStatus === newStatus (idempotent no-op transition)', async () => {
      formSubmissionModel.findById.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, ulbId, stateId }),
      );
      formSubmissionModel.findByIdAndUpdate.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }),
      );

      // SUBMISSION_ACKNOWLEDGED_BY_MOHUA has no allowed forward transitions, but same->same is not validated.
      await expect(
        service.updateFormStatus(
          formSubmissionId,
          FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
          ulbActor,
          'ACKNOWLEDGE_BY_MOHUA',
        ),
      ).resolves.toBeDefined();
    });

    it('applies a valid transition, sets owner fields, and records history', async () => {
      formSubmissionModel.findById.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.IN_PROGRESS, ulbId, stateId }),
      );
      const updated = { currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE };
      formSubmissionModel.findByIdAndUpdate.mockReturnValue(q(updated));

      const result = await service.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.UNDER_REVIEW_BY_STATE,
        ulbActor,
        'SUBMIT',
      );

      expect(result).toEqual(updated);
      const [id, updateData] = formSubmissionModel.findByIdAndUpdate.mock.calls[0] as [string, Record<string, unknown>];
      expect(id).toBe(formSubmissionId);
      expect(updateData.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_STATE);
      expect(updateData.currentOwnerOrgType).toBe('STATE');
      expect((updateData.currentOwnerOrgId as Types.ObjectId).toString()).toBe(stateId.toString());
      // SUBMIT action additionally stamps submittedBy/submittedAt.
      expect(updateData.submittedBy).toBeInstanceOf(Types.ObjectId);
      expect(updateData.submittedAt).toBeInstanceOf(Date);

      expect(formStatusHistoryModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            fromStatus: FORM_STATUS.IN_PROGRESS,
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
            action: 'SUBMIT',
          }),
        ],
        {},
      );
    });

    it('does not stamp submittedBy/submittedAt for non-SUBMIT actions', async () => {
      formSubmissionModel.findById.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.NOT_STARTED, ulbId, stateId }),
      );
      formSubmissionModel.findByIdAndUpdate.mockReturnValue(q({ currentFormStatus: FORM_STATUS.IN_PROGRESS }));

      await service.updateFormStatus(formSubmissionId, FORM_STATUS.IN_PROGRESS, ulbActor, 'SAVE_DRAFT');

      const [, updateData] = formSubmissionModel.findByIdAndUpdate.mock.calls[0] as [string, Record<string, unknown>];
      expect(updateData.submittedBy).toBeUndefined();
      expect(updateData.submittedAt).toBeUndefined();
    });

    it('resolves owner org id to null for statuses with no default owner (e.g. terminal ACK)', async () => {
      formSubmissionModel.findById.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, ulbId, stateId }),
      );
      formSubmissionModel.findByIdAndUpdate.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }),
      );

      await service.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        ulbActor,
        'ACKNOWLEDGE_BY_MOHUA',
      );

      const [, updateData] = formSubmissionModel.findByIdAndUpdate.mock.calls[0] as [string, Record<string, unknown>];
      expect(updateData.currentOwnerOrgType).toBeNull();
      expect(updateData.currentOwnerOrgId).toBeNull();
    });

    it('passes the session through to findById/findByIdAndUpdate and history create when provided', async () => {
      const session: any = { id: 'sess1' };
      formSubmissionModel.findById.mockReturnValue(
        q({ currentFormStatus: FORM_STATUS.NOT_STARTED, ulbId, stateId }),
      );
      formSubmissionModel.findByIdAndUpdate.mockReturnValue(q({ currentFormStatus: FORM_STATUS.IN_PROGRESS }));

      await service.updateFormStatus(formSubmissionId, FORM_STATUS.IN_PROGRESS, ulbActor, 'SAVE_DRAFT', undefined, session);

      expect(formSubmissionModel.findById.mock.results[0].value.session).toHaveBeenCalledWith(session);
      const [, , updateOptions] = formSubmissionModel.findByIdAndUpdate.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { session?: unknown },
      ];
      expect(updateOptions.session).toBe(session);
      expect(formStatusHistoryModel.create).toHaveBeenCalledWith(expect.anything(), { session });
    });
  });

  describe('recordStatusHistory', () => {
    it('resolves actorOrgId from actor.ulb when present', async () => {
      await service.recordStatusHistory(
        formSubmissionId,
        FORM_STATUS.NOT_STARTED,
        FORM_STATUS.IN_PROGRESS,
        ulbActor,
        'SAVE_DRAFT',
      );

      const [[historyDoc]] = formStatusHistoryModel.create.mock.calls[0] as [[Record<string, unknown>]];
      expect((historyDoc.actorOrgId as Types.ObjectId).toString()).toBe(ulbId.toString());
    });

    it('resolves actorOrgId from actor.state when ulb is absent', async () => {
      const stateActor: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.STATE, state: stateId.toString() };

      await service.recordStatusHistory(
        formSubmissionId,
        FORM_STATUS.UNDER_REVIEW_BY_STATE,
        FORM_STATUS.RETURNED_BY_STATE,
        stateActor,
        'RETURN_BY_STATE',
      );

      const [[historyDoc]] = formStatusHistoryModel.create.mock.calls[0] as [[Record<string, unknown>]];
      expect((historyDoc.actorOrgId as Types.ObjectId).toString()).toBe(stateId.toString());
    });

    it('leaves actorOrgId undefined when the actor has neither ulb nor state', async () => {
      const adminActor: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ADMIN };

      await service.recordStatusHistory(
        formSubmissionId,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        adminActor,
        'ACKNOWLEDGE_BY_MOHUA',
      );

      const [[historyDoc]] = formStatusHistoryModel.create.mock.calls[0] as [[Record<string, unknown>]];
      expect(historyDoc.actorOrgId).toBeUndefined();
    });
  });

  describe('getFormStatusHistory', () => {
    it('returns records sorted oldest-first', async () => {
      const records = [{ action: 'SAVE_DRAFT' }, { action: 'SUBMIT' }];
      formStatusHistoryModel.find.mockReturnValue(q(records));

      const result = await service.getFormStatusHistory(formSubmissionId);

      expect(result).toEqual(records);
      expect(formStatusHistoryModel.find.mock.results[0].value.sort).toHaveBeenCalledWith({ createdAt: 1 });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FormWorkflowService } from './form-workflow.service';
import { FormSubmission } from '../schemas/form-submission.schema';
import { FormSubmissionStatusService } from './form-submission-status.service';
import { MessageThreadService } from '../../module/communication/services/message-thread.service';
import { MessageService } from '../../module/communication/services/message.service';
import { NotificationService } from '../../module/notifications/services/notification.service';
import { FormWorkflowPermissions } from '../../common/services/form-workflow.permissions';
import { FORM_STATUS } from '../../common/constants/form-status.constants';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../../module/auth/enum/role.enum';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  chain['lean'] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('FormWorkflowService', () => {
  let service: FormWorkflowService;
  let formSubmissionModel: { findById: jest.Mock };
  let connection: { startSession: jest.Mock };
  let session: { startTransaction: jest.Mock; commitTransaction: jest.Mock; abortTransaction: jest.Mock; endSession: jest.Mock };
  let statusService: { updateFormStatus: jest.Mock };
  let threadService: { syncThreadFormStatus: jest.Mock; findOrCreateFormSubmissionThread: jest.Mock };
  let messageService: { sendWorkflowMessage: jest.Mock };
  let notificationService: { notifyAudience: jest.Mock };
  let formWorkflowPermissions: {
    assertCanEditFormSubmission: jest.Mock;
    assertCanSubmitFormSubmission: jest.Mock;
    assertCanReturnFormSubmission: jest.Mock;
    assertCanApproveFormSubmission: jest.Mock;
    assertCanAcknowledgeFormSubmission: jest.Mock;
  };

  const formSubmissionId = new Types.ObjectId().toString();
  const ulbId = new Types.ObjectId();
  const stateId = new Types.ObjectId();
  const thread = { _id: new Types.ObjectId() };

  const ulbUser: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ULB, ulb: ulbId.toString() };
  const stateUser: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.STATE, state: stateId.toString() };
  const mohuaUser: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.MoHUA };

  function submission(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(formSubmissionId),
      formName: 'Annual Accounts',
      financialYear: '2024-25',
      ulbId,
      stateId,
      currentFormStatus: FORM_STATUS.NOT_STARTED,
      ...overrides,
    };
  }

  beforeEach(async () => {
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    formSubmissionModel = { findById: jest.fn() };
    statusService = { updateFormStatus: jest.fn() };
    threadService = {
      syncThreadFormStatus: jest.fn().mockResolvedValue(undefined),
      findOrCreateFormSubmissionThread: jest.fn().mockResolvedValue(thread),
    };
    messageService = { sendWorkflowMessage: jest.fn().mockResolvedValue(undefined) };
    notificationService = { notifyAudience: jest.fn().mockResolvedValue(undefined) };
    formWorkflowPermissions = {
      assertCanEditFormSubmission: jest.fn(),
      assertCanSubmitFormSubmission: jest.fn(),
      assertCanReturnFormSubmission: jest.fn(),
      assertCanApproveFormSubmission: jest.fn(),
      assertCanAcknowledgeFormSubmission: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormWorkflowService,
        { provide: getModelToken(FormSubmission.name), useValue: formSubmissionModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: FormSubmissionStatusService, useValue: statusService },
        { provide: MessageThreadService, useValue: threadService },
        { provide: MessageService, useValue: messageService },
        { provide: NotificationService, useValue: notificationService },
        { provide: FormWorkflowPermissions, useValue: formWorkflowPermissions },
      ],
    }).compile();

    service = module.get<FormWorkflowService>(FormWorkflowService);
  });

  describe('saveDraft', () => {
    it('throws NotFoundException when the submission does not exist', async () => {
      formSubmissionModel.findById.mockReturnValue(q(null));

      await expect(service.saveDraft(formSubmissionId, ulbUser, {})).rejects.toThrow(NotFoundException);
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the user cannot edit, without starting a transaction', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission()));
      formWorkflowPermissions.assertCanEditFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.saveDraft(formSubmissionId, ulbUser, {})).rejects.toThrow(ForbiddenException);
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('transitions NOT_STARTED -> IN_PROGRESS within a committed transaction', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.NOT_STARTED })));
      const updated = submission({ currentFormStatus: FORM_STATUS.IN_PROGRESS });
      statusService.updateFormStatus.mockResolvedValue(updated);

      const result = await service.saveDraft(formSubmissionId, ulbUser, {});

      expect(result).toEqual(updated);
      expect(statusService.updateFormStatus).toHaveBeenCalledWith(
        formSubmissionId,
        FORM_STATUS.IN_PROGRESS,
        ulbUser,
        'SAVE_DRAFT',
        undefined,
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });

    it('is a no-op (skips the transaction entirely) when status is already past NOT_STARTED', async () => {
      const current = submission({ currentFormStatus: FORM_STATUS.IN_PROGRESS });
      formSubmissionModel.findById.mockReturnValue(q(current));

      const result = await service.saveDraft(formSubmissionId, ulbUser, {});

      expect(result).toEqual(current);
      expect(connection.startSession).not.toHaveBeenCalled();
      expect(statusService.updateFormStatus).not.toHaveBeenCalled();
    });

    it('aborts the transaction and rethrows when the status update fails', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.NOT_STARTED })));
      statusService.updateFormStatus.mockRejectedValue(new Error('db write failed'));

      await expect(service.saveDraft(formSubmissionId, ulbUser, {})).rejects.toThrow('db write failed');
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });
  });

  describe('submitForm', () => {
    it('throws ForbiddenException when the user cannot submit', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission()));
      formWorkflowPermissions.assertCanSubmitFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.submitForm(formSubmissionId, ulbUser)).rejects.toThrow(ForbiddenException);
    });

    it('transitions to UNDER_REVIEW_BY_STATE, syncs the thread, and notifies STATE', async () => {
      const current = submission({ currentFormStatus: FORM_STATUS.IN_PROGRESS });
      formSubmissionModel.findById.mockReturnValue(q(current));
      const updated = submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE });
      statusService.updateFormStatus.mockResolvedValue(updated);

      const result = await service.submitForm(formSubmissionId, ulbUser);

      expect(result).toEqual(updated);
      expect(statusService.updateFormStatus).toHaveBeenCalledWith(
        formSubmissionId,
        FORM_STATUS.UNDER_REVIEW_BY_STATE,
        ulbUser,
        'SUBMIT',
        undefined,
        session,
      );
      expect(threadService.syncThreadFormStatus).toHaveBeenCalledWith(updated, session);
      expect(threadService.findOrCreateFormSubmissionThread).not.toHaveBeenCalled();
      expect(notificationService.notifyAudience).toHaveBeenCalledWith(
        expect.objectContaining({ audience: { orgType: 'STATE', orgId: stateId.toString() }, session }),
      );
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('aborts the transaction when notification delivery throws', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.IN_PROGRESS })));
      statusService.updateFormStatus.mockResolvedValue(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }));
      notificationService.notifyAudience.mockRejectedValue(new Error('notify failed'));

      await expect(service.submitForm(formSubmissionId, ulbUser)).rejects.toThrow('notify failed');
      expect(session.abortTransaction).toHaveBeenCalled();
    });
  });

  describe('returnByState', () => {
    it('throws ForbiddenException when the user cannot return the form', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission()));
      formWorkflowPermissions.assertCanReturnFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.returnByState(formSubmissionId, stateUser, { remarks: 'fix it' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('always creates/finds the thread, posts remarks, and notifies ULB', async () => {
      const current = submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE });
      formSubmissionModel.findById.mockReturnValue(q(current));
      const updated = submission({ currentFormStatus: FORM_STATUS.RETURNED_BY_STATE });
      statusService.updateFormStatus.mockResolvedValue(updated);

      const result = await service.returnByState(formSubmissionId, stateUser, { remarks: 'Please fix section 3' });

      expect(result).toEqual(updated);
      expect(threadService.findOrCreateFormSubmissionThread).toHaveBeenCalledWith(updated, stateUser, session);
      expect(messageService.sendWorkflowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: thread._id.toString(),
          senderUser: stateUser,
          body: 'Please fix section 3',
          visibility: 'EXTERNAL',
        }),
        session,
      );
      expect(notificationService.notifyAudience).toHaveBeenCalledWith(
        expect.objectContaining({ audience: { orgType: 'ULB', orgId: ulbId.toString() } }),
      );
      expect(session.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('approveByState', () => {
    it('creates a thread and posts a message only when remarks are provided', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE })));
      const updated = submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      statusService.updateFormStatus.mockResolvedValue(updated);

      await service.approveByState(formSubmissionId, stateUser, { remarks: 'Looks good' });

      expect(threadService.findOrCreateFormSubmissionThread).toHaveBeenCalledWith(updated, stateUser, session);
      expect(messageService.sendWorkflowMessage).toHaveBeenCalled();
      expect(notificationService.notifyAudience).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: thread._id.toString() }),
      );
    });

    it('skips thread creation and message posting when no remarks are provided, but still syncs status', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE })));
      const updated = submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      statusService.updateFormStatus.mockResolvedValue(updated);

      await service.approveByState(formSubmissionId, stateUser);

      expect(threadService.findOrCreateFormSubmissionThread).not.toHaveBeenCalled();
      expect(messageService.sendWorkflowMessage).not.toHaveBeenCalled();
      expect(threadService.syncThreadFormStatus).toHaveBeenCalledWith(updated, session);
      expect(notificationService.notifyAudience).toHaveBeenCalledWith(
        expect.objectContaining({ audience: { orgType: 'MoHUA' }, threadId: undefined }),
      );
    });

    it('throws ForbiddenException when the user cannot approve', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE })));
      formWorkflowPermissions.assertCanApproveFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.approveByState(formSubmissionId, stateUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('returnByMoHUA', () => {
    it('always creates the thread, posts remarks, and notifies both ULB and STATE', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      const updated = submission({ currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA });
      statusService.updateFormStatus.mockResolvedValue(updated);

      const result = await service.returnByMoHUA(formSubmissionId, mohuaUser, { remarks: 'Send more docs' });

      expect(result).toEqual(updated);
      expect(threadService.findOrCreateFormSubmissionThread).toHaveBeenCalledWith(updated, mohuaUser, session);
      expect(messageService.sendWorkflowMessage).toHaveBeenCalled();
      expect(notificationService.notifyAudience).toHaveBeenCalledTimes(2);
      const audiences = notificationService.notifyAudience.mock.calls.map((c) => (c[0] as { audience: unknown }).audience);
      expect(audiences).toEqual(
        expect.arrayContaining([
          { orgType: 'ULB', orgId: ulbId.toString() },
          { orgType: 'STATE', orgId: stateId.toString() },
        ]),
      );
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('throws ForbiddenException when the user cannot return the form', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      formWorkflowPermissions.assertCanReturnFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.returnByMoHUA(formSubmissionId, mohuaUser, { remarks: 'x' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('acknowledgeByMoHUA', () => {
    it('creates a thread and notifies both orgs when remarks are provided', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      const updated = submission({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA });
      statusService.updateFormStatus.mockResolvedValue(updated);

      const result = await service.acknowledgeByMoHUA(formSubmissionId, mohuaUser, { remarks: 'All good' });

      expect(result).toEqual(updated);
      expect(threadService.findOrCreateFormSubmissionThread).toHaveBeenCalledWith(updated, mohuaUser, session);
      expect(messageService.sendWorkflowMessage).toHaveBeenCalled();
      expect(notificationService.notifyAudience).toHaveBeenCalledTimes(2);
    });

    it('skips thread creation when no remarks are provided but still notifies both orgs', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      const updated = submission({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA });
      statusService.updateFormStatus.mockResolvedValue(updated);

      await service.acknowledgeByMoHUA(formSubmissionId, mohuaUser);

      expect(threadService.findOrCreateFormSubmissionThread).not.toHaveBeenCalled();
      expect(messageService.sendWorkflowMessage).not.toHaveBeenCalled();
      expect(threadService.syncThreadFormStatus).toHaveBeenCalledWith(updated, session);
      expect(notificationService.notifyAudience).toHaveBeenCalledTimes(2);
    });

    it('throws ForbiddenException when the user cannot acknowledge', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      formWorkflowPermissions.assertCanAcknowledgeFormSubmission.mockImplementation(() => {
        throw new ForbiddenException('nope');
      });

      await expect(service.acknowledgeByMoHUA(formSubmissionId, mohuaUser)).rejects.toThrow(ForbiddenException);
    });

    it('aborts the transaction when the thread/message step fails', async () => {
      formSubmissionModel.findById.mockReturnValue(q(submission({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      statusService.updateFormStatus.mockResolvedValue(
        submission({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }),
      );
      messageService.sendWorkflowMessage.mockRejectedValue(new Error('message send failed'));

      await expect(service.acknowledgeByMoHUA(formSubmissionId, mohuaUser, { remarks: 'x' })).rejects.toThrow(
        'message send failed',
      );
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });
  });
});

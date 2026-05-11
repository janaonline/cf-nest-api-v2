import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { CONTEXT_TYPE, MESSAGE_VISIBILITY } from '../../common/constants/communication.constants';
import { FORM_STATUS } from '../../common/constants/form-status.constants';
import { FORM_WORKFLOW_ACTION, NOTIFICATION_TYPE } from '../../common/constants/workflow.constants';
import { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { FormWorkflowPermissions } from '../../common/services/form-workflow.permissions';
import { MessageThreadService } from '../../communication/services/message-thread.service';
import { MessageService } from '../../communication/services/message.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { AcknowledgeFormDto } from '../dto/acknowledge-form.dto';
import { ApproveFormDto } from '../dto/approve-form.dto';
import { ReturnFormDto } from '../dto/return-form.dto';
import { SaveDraftDto } from '../dto/save-draft.dto';
import { IFormSubmission } from '../interfaces/form-submission.interface';
import { FormSubmission, FormSubmissionDocument } from '../schemas/form-submission.schema';
import { FormSubmissionStatusService } from './form-submission-status.service';

@Injectable()
export class FormWorkflowService {
  constructor(
    @InjectModel(FormSubmission.name)
    private readonly formSubmissionModel: Model<FormSubmissionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly statusService: FormSubmissionStatusService,
    private readonly threadService: MessageThreadService,
    private readonly messageService: MessageService,
    private readonly notificationService: NotificationService,
    private readonly formWorkflowPermissions: FormWorkflowPermissions,
  ) {}

  /**
   * Transitions status from NOT_STARTED → IN_PROGRESS on the first call; subsequent calls are no-ops.
   * Form data lives in its own collection (formDataCollection) and is not stored here.
   * @param formSubmissionId Form to transition.
   * @param user Authenticated ULB user.
   * @param _dto Reserved for future use.
   * @returns Updated form submission with IN_PROGRESS (or current) status.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async saveDraft(formSubmissionId: string, user: IAuthUser, _dto: SaveDraftDto): Promise<IFormSubmission> {
    const submission = await this.findSubmission(formSubmissionId);
    this.formWorkflowPermissions.assertCanEditFormSubmission(user, submission);

    if (submission.currentFormStatus !== FORM_STATUS.NOT_STARTED) {
      return submission;
    }

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.statusService.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.IN_PROGRESS,
        user,
        FORM_WORKFLOW_ACTION.SAVE_DRAFT,
        undefined,
        session,
      );

      await session.commitTransaction();
      return updated;
    } catch (err: unknown) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Submits a form to State for review.
   * Pure workflow event — no message thread is created. Threads are created lazily on the
   * first communication event (e.g. a State return with remarks). Syncs the cached status
   * on any thread that already exists from a previous workflow cycle.
   * @param formSubmissionId Form to submit.
   * @param user Authenticated ULB user.
   * @returns Updated form with UNDER_REVIEW_BY_STATE status.
   */
  async submitForm(formSubmissionId: string, user: IAuthUser): Promise<IFormSubmission> {
    const submission = await this.findSubmission(formSubmissionId);
    this.formWorkflowPermissions.assertCanSubmitFormSubmission(user, submission);

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.statusService.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.UNDER_REVIEW_BY_STATE,
        user,
        FORM_WORKFLOW_ACTION.SUBMIT,
        undefined,
        session,
      );

      // Sync cached status on any existing thread (safe no-op if no thread yet).
      await this.threadService.syncThreadFormStatus(updated, session);

      await this.notificationService.notifyAudience({
        audience: { orgType: 'STATE', orgId: submission.stateId?.toString() },
        type: NOTIFICATION_TYPE.FORM_SUBMITTED,
        title: 'New Form Submission',
        message: `${submission.formName} has been submitted by ULB for review.`,
        contextType: CONTEXT_TYPE.FORM_SUBMISSION,
        contextId: formSubmissionId,
        financialYear: submission.financialYear,
        redirectUrl: `/forms/${formSubmissionId}`,
        session,
      });

      await session.commitTransaction();
      return updated;
    } catch (err: unknown) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Returns a form to ULB from State review within a transaction.
   * Always creates the communication thread (remarks are mandatory) and posts the
   * remarks as an EXTERNAL message visible to ULB.
   * @param formSubmissionId Form to return.
   * @param user Authenticated STATE user.
   * @param dto Return remarks (required).
   * @returns Updated form with RETURNED_BY_STATE status.
   */
  async returnByState(formSubmissionId: string, user: IAuthUser, dto: ReturnFormDto): Promise<IFormSubmission> {
    const submission = await this.findSubmission(formSubmissionId);
    this.formWorkflowPermissions.assertCanReturnFormSubmission(user, submission);

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.statusService.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.RETURNED_BY_STATE,
        user,
        FORM_WORKFLOW_ACTION.RETURN_BY_STATE,
        dto.remarks,
        session,
      );

      const thread = await this.threadService.findOrCreateFormSubmissionThread(updated, user, session);
      await this.threadService.syncThreadFormStatus(updated, session);

      await this.messageService.sendWorkflowMessage(
        {
          threadId: thread._id.toString(),
          senderUser: user,
          body: dto.remarks,
          visibility: MESSAGE_VISIBILITY.EXTERNAL,
        },
        session,
      );

      await this.notificationService.notifyAudience({
        audience: { orgType: 'ULB', orgId: submission.ulbId?.toString() },
        type: NOTIFICATION_TYPE.FORM_RETURNED_BY_STATE,
        title: 'Form Returned by State',
        message: `${submission.formName} has been returned by State. Remarks: ${dto.remarks}`,
        contextType: CONTEXT_TYPE.FORM_SUBMISSION,
        contextId: formSubmissionId,
        threadId: thread._id.toString(),
        financialYear: submission.financialYear,
        redirectUrl: `/forms/${formSubmissionId}`,
        session,
      });

      await session.commitTransaction();
      return updated;
    } catch (err: unknown) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Approves a form from State review and forwards it to MoHUA within a transaction.
   * Creates the communication thread and posts a message only when remarks are provided.
   * Without remarks this is a pure workflow event and no thread is created.
   * @param formSubmissionId Form to approve.
   * @param user Authenticated STATE user.
   * @param dto Optional approval remarks.
   * @returns Updated form with UNDER_REVIEW_BY_MOHUA status.
   */
  async approveByState(formSubmissionId: string, user: IAuthUser, dto?: ApproveFormDto): Promise<IFormSubmission> {
    const submission = await this.findSubmission(formSubmissionId);
    this.formWorkflowPermissions.assertCanApproveFormSubmission(user, submission);

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.statusService.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        user,
        FORM_WORKFLOW_ACTION.APPROVE_BY_STATE,
        dto?.remarks,
        session,
      );

      let threadId: string | undefined;

      if (dto?.remarks) {
        const thread = await this.threadService.findOrCreateFormSubmissionThread(updated, user, session);
        await this.threadService.syncThreadFormStatus(updated, session);
        threadId = thread._id.toString();

        await this.messageService.sendWorkflowMessage(
          {
            threadId,
            senderUser: user,
            body: dto.remarks,
            visibility: MESSAGE_VISIBILITY.EXTERNAL,
          },
          session,
        );
      } else {
        // No thread created — sync status on any existing thread from a prior cycle.
        await this.threadService.syncThreadFormStatus(updated, session);
      }

      await this.notificationService.notifyAudience({
        audience: { orgType: 'MoHUA' },
        type: NOTIFICATION_TYPE.FORM_APPROVED_BY_STATE,
        title: 'Form Forwarded for MoHUA Review',
        message: `${submission.formName} has been approved by State and is now pending MoHUA review.`,
        contextType: CONTEXT_TYPE.FORM_SUBMISSION,
        contextId: formSubmissionId,
        threadId,
        financialYear: submission.financialYear,
        redirectUrl: `/forms/${formSubmissionId}`,
        session,
      });

      await session.commitTransaction();
      return updated;
    } catch (err: unknown) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Returns a form to ULB from MoHUA review within a transaction.
   * Always creates the communication thread (remarks are mandatory) and posts the
   * remarks as an EXTERNAL message. Notifies both ULB and State.
   * @param formSubmissionId Form to return.
   * @param user Authenticated MoHUA user.
   * @param dto Return remarks (required).
   * @returns Updated form with RETURNED_BY_MOHUA status.
   */
  async returnByMoHUA(formSubmissionId: string, user: IAuthUser, dto: ReturnFormDto): Promise<IFormSubmission> {
    const submission = await this.findSubmission(formSubmissionId);
    this.formWorkflowPermissions.assertCanReturnFormSubmission(user, submission);

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.statusService.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.RETURNED_BY_MOHUA,
        user,
        FORM_WORKFLOW_ACTION.RETURN_BY_MOHUA,
        dto.remarks,
        session,
      );

      const thread = await this.threadService.findOrCreateFormSubmissionThread(updated, user, session);
      await this.threadService.syncThreadFormStatus(updated, session);

      await this.messageService.sendWorkflowMessage(
        {
          threadId: thread._id.toString(),
          senderUser: user,
          body: dto.remarks,
          visibility: MESSAGE_VISIBILITY.EXTERNAL,
        },
        session,
      );

      await Promise.all([
        this.notificationService.notifyAudience({
          audience: { orgType: 'ULB', orgId: submission.ulbId?.toString() },
          type: NOTIFICATION_TYPE.FORM_RETURNED_BY_MOHUA,
          title: 'Form Returned by MoHUA',
          message: `${submission.formName} has been returned by MoHUA. Remarks: ${dto.remarks}`,
          contextType: CONTEXT_TYPE.FORM_SUBMISSION,
          contextId: formSubmissionId,
          threadId: thread._id.toString(),
          financialYear: submission.financialYear,
          redirectUrl: `/forms/${formSubmissionId}`,
          session,
        }),
        this.notificationService.notifyAudience({
          audience: { orgType: 'STATE', orgId: submission.stateId?.toString() },
          type: NOTIFICATION_TYPE.FORM_RETURNED_BY_MOHUA,
          title: 'Form Returned by MoHUA',
          message: `${submission.formName} has been returned by MoHUA to ULB.`,
          contextType: CONTEXT_TYPE.FORM_SUBMISSION,
          contextId: formSubmissionId,
          threadId: thread._id.toString(),
          financialYear: submission.financialYear,
          redirectUrl: `/forms/${formSubmissionId}`,
          session,
        }),
      ]);

      await session.commitTransaction();
      return updated;
    } catch (err: unknown) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Acknowledges a form submission as complete within a transaction.
   * Creates the communication thread and posts a message only when remarks are provided.
   * Without remarks this is a pure workflow event and no thread is created. Notifies both ULB and State.
   * @param formSubmissionId Form to acknowledge.
   * @param user Authenticated MoHUA user.
   * @param dto Optional acknowledgement remarks.
   * @returns Updated form with SUBMISSION_ACKNOWLEDGED_BY_MOHUA status.
   */
  async acknowledgeByMoHUA(
    formSubmissionId: string,
    user: IAuthUser,
    dto?: AcknowledgeFormDto,
  ): Promise<IFormSubmission> {
    const submission = await this.findSubmission(formSubmissionId);
    this.formWorkflowPermissions.assertCanAcknowledgeFormSubmission(user, submission);

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.statusService.updateFormStatus(
        formSubmissionId,
        FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        user,
        FORM_WORKFLOW_ACTION.ACKNOWLEDGE_BY_MOHUA,
        dto?.remarks,
        session,
      );

      let threadId: string | undefined;

      if (dto?.remarks) {
        const thread = await this.threadService.findOrCreateFormSubmissionThread(updated, user, session);
        await this.threadService.syncThreadFormStatus(updated, session);
        threadId = thread._id.toString();

        await this.messageService.sendWorkflowMessage(
          {
            threadId,
            senderUser: user,
            body: dto.remarks,
            visibility: MESSAGE_VISIBILITY.EXTERNAL,
          },
          session,
        );
      } else {
        await this.threadService.syncThreadFormStatus(updated, session);
      }

      await Promise.all([
        this.notificationService.notifyAudience({
          audience: { orgType: 'ULB', orgId: submission.ulbId?.toString() },
          type: NOTIFICATION_TYPE.FORM_ACKNOWLEDGED_BY_MOHUA,
          title: 'Form Acknowledged by MoHUA',
          message: `${submission.formName} has been acknowledged by MoHUA.`,
          contextType: CONTEXT_TYPE.FORM_SUBMISSION,
          contextId: formSubmissionId,
          threadId,
          financialYear: submission.financialYear,
          redirectUrl: `/forms/${formSubmissionId}`,
          session,
        }),
        this.notificationService.notifyAudience({
          audience: { orgType: 'STATE', orgId: submission.stateId?.toString() },
          type: NOTIFICATION_TYPE.FORM_ACKNOWLEDGED_BY_MOHUA,
          title: 'Form Acknowledged by MoHUA',
          message: `${submission.formName} has been acknowledged by MoHUA.`,
          contextType: CONTEXT_TYPE.FORM_SUBMISSION,
          contextId: formSubmissionId,
          threadId,
          financialYear: submission.financialYear,
          redirectUrl: `/forms/${formSubmissionId}`,
          session,
        }),
      ]);

      await session.commitTransaction();
      return updated;
    } catch (err: unknown) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  private async findSubmission(id: string): Promise<IFormSubmission> {
    const record = await this.formSubmissionModel.findById(id).lean().exec();
    if (!record) throw new NotFoundException(`Form submission ${id} not found`);
    return record as unknown as IFormSubmission;
  }
}

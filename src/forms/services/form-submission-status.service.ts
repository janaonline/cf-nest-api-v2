import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { getDefaultOwnerForStatus } from '../../common/constants/form-status.constants';
import { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { assertValidFormStatusTransition } from '../../common/utils/form-status-transitions';
import { IFormStatusHistory } from '../interfaces/form-status-history.interface';
import { IFormSubmission } from '../interfaces/form-submission.interface';
import { FormStatusHistory, FormStatusHistoryDocument } from '../schemas/form-status-history.schema';
import { FormSubmission, FormSubmissionDocument } from '../schemas/form-submission.schema';

@Injectable()
export class FormSubmissionStatusService {
  constructor(
    @InjectModel(FormSubmission.name)
    private readonly formSubmissionModel: Model<FormSubmissionDocument>,
    @InjectModel(FormStatusHistory.name)
    private readonly formStatusHistoryModel: Model<FormStatusHistoryDocument>,
  ) {}

  /**
   * Transitions a form submission to a new status, updates owner fields, and writes a history record.
   * Validates the transition against ALLOWED_TRANSITIONS before applying any changes.
   * @param formSubmissionId Form to update.
   * @param newStatus Target status to transition to.
   * @param actor User performing the action (stored as lastActionBy).
   * @param action Workflow action string written to the history record (e.g. 'SUBMIT').
   * @param remarks Optional remarks written to the history record.
   * @param session Optional MongoDB transaction session.
   * @returns Updated form submission after the transition.
   */
  async updateFormStatus(
    formSubmissionId: string,
    newStatus: number,
    actor: IAuthUser,
    action: string,
    remarks?: string,
    session?: ClientSession,
  ): Promise<IFormSubmission> {
    const submission = await this.formSubmissionModel
      .findById(formSubmissionId)
      .session(session ?? null)
      .exec();

    if (!submission) {
      throw new NotFoundException(`Form submission ${formSubmissionId} not found`);
    }

    const fromStatus = submission.currentFormStatus;

    if (fromStatus !== newStatus) {
      assertValidFormStatusTransition(fromStatus, newStatus);
    }

    const ownerOrgType = getDefaultOwnerForStatus(newStatus);
    const ownerOrgId = this.resolveOwnerOrgId(ownerOrgType, submission as unknown as IFormSubmission);

    const updateData: Record<string, unknown> = {
      currentFormStatus: newStatus,
      currentOwnerOrgType: ownerOrgType,
      currentOwnerOrgId: ownerOrgId,
      currentOwnerRoleCode: ownerOrgType,
      lastActionBy: new Types.ObjectId(actor._id),
      lastActionAt: new Date(),
    };

    if (action === 'SUBMIT') {
      updateData['submittedBy'] = new Types.ObjectId(actor._id);
      updateData['submittedAt'] = new Date();
    }

    await this.formSubmissionModel.findByIdAndUpdate(formSubmissionId, updateData, { session: session ?? null }).exec();

    await this.recordStatusHistory(formSubmissionId, fromStatus, newStatus, actor, action, remarks, session);

    const updated = await this.formSubmissionModel
      .findById(formSubmissionId)
      .session(session ?? null)
      .lean()
      .exec();

    return updated as unknown as IFormSubmission;
  }

  /**
   * Writes a single audit-trail entry for a form status transition.
   * @param formSubmissionId Form whose status changed.
   * @param fromStatus Previous status value.
   * @param toStatus New status value.
   * @param actor User who triggered the transition.
   * @param action Workflow action identifier (e.g. 'SUBMIT', 'RETURN_BY_STATE').
   * @param remarks Optional remarks explaining the action.
   * @param session Optional MongoDB transaction session.
   */
  async recordStatusHistory(
    formSubmissionId: string,
    fromStatus: number,
    toStatus: number,
    actor: IAuthUser,
    action: string,
    remarks?: string,
    session?: ClientSession,
  ): Promise<void> {
    const historyDoc = {
      formSubmissionId: new Types.ObjectId(formSubmissionId),
      fromStatus,
      toStatus,
      action,
      remarks,
      actorUserId: new Types.ObjectId(actor._id),
      actorOrgType: actor.role as string,
      actorOrgId: this.resolveActorOrgId(actor),
      actorRoleCode: actor.role as string,
    };

    const insertOptions: { session?: ClientSession } = session ? { session } : {};
    await this.formStatusHistoryModel.create([historyDoc], insertOptions);
  }

  /**
   * Fetches the chronological audit trail of status transitions for a form.
   * @param formSubmissionId Form to retrieve history for.
   * @returns Status history records ordered oldest-first.
   */
  async getFormStatusHistory(formSubmissionId: string): Promise<IFormStatusHistory[]> {
    const records = await this.formStatusHistoryModel
      .find({ formSubmissionId: new Types.ObjectId(formSubmissionId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return records as unknown as IFormStatusHistory[];
  }

  private resolveOwnerOrgId(ownerOrgType: string | null, submission: IFormSubmission): Types.ObjectId | null {
    if (!ownerOrgType) return null;
    if (ownerOrgType === 'ULB') return submission.ulbId ?? null;
    if (ownerOrgType === 'STATE') return submission.stateId ?? null;
    return null;
  }

  private resolveActorOrgId(actor: IAuthUser): Types.ObjectId | undefined {
    if (actor.ulb) return new Types.ObjectId(actor.ulb);
    if (actor.state) return new Types.ObjectId(actor.state);
    return undefined;
  }
}

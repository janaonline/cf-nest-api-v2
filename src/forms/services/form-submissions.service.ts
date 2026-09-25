import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { FormWorkflowPermissions } from '../../common/services/form-workflow.permissions';
import { IFormSubmission } from '../interfaces/form-submission.interface';
import { FormSubmission, FormSubmissionDocument } from '../schemas/form-submission.schema';

@Injectable()
export class FormSubmissionsService {
  constructor(
    @InjectModel(FormSubmission.name)
    private readonly formSubmissionModel: Model<FormSubmissionDocument>,
    private readonly formWorkflowPermissions: FormWorkflowPermissions,
  ) {}

  /**
   * Fetches a single form submission by ID and enforces view-level access for the requesting user.
   * @param id Form submission ObjectId string.
   * @param user Authenticated user whose role determines view access.
   * @returns The matching form submission.
   * @throws NotFoundException if the ID does not exist.
   * @throws ForbiddenException if the user lacks view access to this submission.
   */
  async getFormSubmissionById(id: string, user: IAuthUser): Promise<IFormSubmission> {
    const record = await this.formSubmissionModel.findById(id).lean().exec();
    if (!record) throw new NotFoundException('Form submission not found');

    const submission = record as unknown as IFormSubmission;
    this.formWorkflowPermissions.assertCanViewFormSubmission(user, submission);
    return submission;
  }

  /**
   * Fetches all active form submissions for a ULB in the given financial year, newest first.
   * @param ulbId ULB ObjectId string to filter by.
   * @param financialYear Financial year string (e.g. "2024-25").
   * @returns All matching active submissions sorted by creation date descending.
   */
  async getFormSubmissionsByULB(ulbId: string, financialYear: string): Promise<IFormSubmission[]> {
    const records = await this.formSubmissionModel
      .find({ ulbId: new Types.ObjectId(ulbId), financialYear })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return records as unknown as IFormSubmission[];
  }

  /**
   * Fetches all active form submissions under a State in the given financial year, newest first.
   * @param stateId State ObjectId string to filter by.
   * @param financialYear Financial year string (e.g. "2024-25").
   * @returns All matching active submissions sorted by creation date descending.
   */
  async getFormSubmissionsByState(stateId: string, financialYear: string): Promise<IFormSubmission[]> {
    const records = await this.formSubmissionModel
      .find({ stateId: new Types.ObjectId(stateId), financialYear })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return records as unknown as IFormSubmission[];
  }
}

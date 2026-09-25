import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS } from '../../common/constants/form-status.constants';
import { IFormSubmission } from '../interfaces/form-submission.interface';
import { FormSubmission, FormSubmissionDocument } from '../schemas/form-submission.schema';

export interface FindOrCreateFormSubmissionInput {
  formType: string;
  formName: string;
  formJsonId?: string;
  formDataCollection: string;
  formDataId: string;
  designYear: string;
  financialYear?: string;
  ownerType: 'ULB' | 'STATE' | 'MOHUA';
  ulbId?: string;
  stateId?: string;
  session?: ClientSession;
}

@Injectable()
export class FormSubmissionSyncService {
  constructor(
    @InjectModel(FormSubmission.name)
    private readonly formSubmissionModel: Model<FormSubmissionDocument>,
  ) {}

  /**
   * Finds the existing workflow record for a form data document or creates a new one.
   * Idempotent — the unique index on {formType, formDataCollection, formDataId} prevents duplicates
   * under concurrent calls. Exactly one workflow record is guaranteed per form data document.
   * @param input Parameters needed to locate or create the workflow record.
   * @returns Existing or newly created form submission.
   * @throws BadRequestException if formDataId or designYear are invalid ObjectId strings.
   */
  async findOrCreateFormSubmissionForDataRecord(input: FindOrCreateFormSubmissionInput): Promise<IFormSubmission> {
    if (!Types.ObjectId.isValid(input.formDataId)) {
      throw new BadRequestException('Invalid formDataId');
    }
    if (!Types.ObjectId.isValid(input.designYear)) {
      throw new BadRequestException('Invalid designYear');
    }

    const formDataId = new Types.ObjectId(input.formDataId);
    const designYear = new Types.ObjectId(input.designYear);
    const sessionOpt = input.session ?? null;

    const existing = await this.formSubmissionModel
      .findOne({ formType: input.formType, formDataCollection: input.formDataCollection, formDataId })
      .session(sessionOpt)
      .lean()
      .exec();

    if (existing) return existing as unknown as IFormSubmission;

    const ulbId = input.ulbId && Types.ObjectId.isValid(input.ulbId) ? new Types.ObjectId(input.ulbId) : undefined;
    const stateId =
      input.stateId && Types.ObjectId.isValid(input.stateId) ? new Types.ObjectId(input.stateId) : undefined;
    const formJsonId =
      input.formJsonId && Types.ObjectId.isValid(input.formJsonId) ? new Types.ObjectId(input.formJsonId) : undefined;

    const [created] = await this.formSubmissionModel.create(
      [
        {
          formType: input.formType,
          formName: input.formName,
          formJsonId,
          formDataCollection: input.formDataCollection,
          formDataId,
          designYear,
          financialYear: input.financialYear,
          ownerType: input.ownerType,
          ulbId,
          stateId,
          currentFormStatus: FORM_STATUS.NOT_STARTED,
          currentOwnerOrgType: input.ownerType,
          currentOwnerOrgId: input.ownerType === 'ULB' ? ulbId : stateId,
          currentOwnerRoleCode: input.ownerType,
        },
      ],
      { session: input.session },
    );

    return created as unknown as IFormSubmission;
  }

  /**
   * Fetches paginated form submissions scoped to an owner org, sorted newest-first.
   * O(n) — uses compound indexed query plus skip/limit pagination.
   * @param ownerType Org type to scope by ('ULB', 'STATE', or 'MOHUA').
   * @param ownerId Org ObjectId string (ulbId for ULB, stateId for STATE).
   * @param designYear Design year ObjectId string to filter by.
   * @param page Page number, 1-indexed.
   * @param limit Records per page.
   * @returns Paginated submissions and total count.
   * @throws BadRequestException if ownerId or designYear are invalid ObjectId strings.
   */
  async getFormSubmissionsByOwner(
    ownerType: 'ULB' | 'STATE' | 'MOHUA',
    ownerId: string,
    designYear: string,
    page = 1,
    limit = 10,
  ): Promise<{ data: IFormSubmission[]; total: number }> {
    if (!Types.ObjectId.isValid(ownerId) || !Types.ObjectId.isValid(designYear)) {
      throw new BadRequestException('Invalid ownerId or designYear');
    }

    const ownerIdObj = new Types.ObjectId(ownerId);
    const designYearObj = new Types.ObjectId(designYear);
    const query: Record<string, unknown> = { ownerType, designYear: designYearObj };

    if (ownerType === 'ULB') query['ulbId'] = ownerIdObj;
    else if (ownerType === 'STATE') query['stateId'] = ownerIdObj;

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.formSubmissionModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.formSubmissionModel.countDocuments(query).exec(),
    ]);

    return { data: data as unknown as IFormSubmission[], total };
  }
}

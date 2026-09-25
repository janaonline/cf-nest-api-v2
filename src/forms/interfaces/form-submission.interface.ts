import { Types } from 'mongoose';
import { FormStatusType } from '../../common/constants/form-status.constants';

/** Plain-object shape returned by .lean() queries on form_submissions. */
export interface IFormSubmission {
  _id: Types.ObjectId;

  // Form identity
  formType: string;
  formName: string;
  formId?: number;
  formJsonId?: Types.ObjectId;

  // Link to actual form data in its native collection
  formDataCollection: string;
  formDataId: Types.ObjectId;

  // Temporal context
  designYear: Types.ObjectId;
  financialYear?: string;

  // Ownership
  ownerType: 'ULB' | 'STATE' | 'MOHUA';
  ulbId?: Types.ObjectId;
  stateId?: Types.ObjectId;

  // Workflow status
  currentFormStatus: FormStatusType;
  currentOwnerOrgType?: string | null;
  currentOwnerOrgId?: Types.ObjectId | null;
  currentOwnerRoleCode?: string | null;

  // Audit
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;
  lastActionBy?: Types.ObjectId;
  lastActionAt?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

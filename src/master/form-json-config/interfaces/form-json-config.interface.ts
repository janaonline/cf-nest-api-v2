import { Types } from 'mongoose';
import { SubmissionScope } from 'src/schemas/form-json-config.schema';

/** Plain-object shape returned by .lean() queries on the formjsonconfigs collection. */
export interface IFormJsonConfig {
  _id: Types.ObjectId;
  formId: number;
  isApplicableForExemption: boolean;
  exemptionGraceYears: number;
  submissionScope: SubmissionScope;
  isActive: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

/** `findAllExemptable()`'s row shape — the stored config plus a computed, non-persisted display
 *  label (see `../constants/form-labels.constants.ts`), so read-only UI (e.g. the ULB review
 *  dialog's exemption checklist) doesn't need its own formId -> label map. */
export interface IExemptableFormJsonConfig extends IFormJsonConfig {
  label: string;
}

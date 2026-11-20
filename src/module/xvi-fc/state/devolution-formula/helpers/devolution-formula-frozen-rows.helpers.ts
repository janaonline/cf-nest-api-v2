import type { Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { DevolutionFormulaRowDocument } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import type { ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';

/** A row a claim letter moved on (SO-approved, then acknowledged): its allocation is part of a reviewed claim. */
export const DF_FROZEN_ROW_STATUSES: readonly number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

/**
 * Re-upload, revalidate and delete replace the whole active dataset, so they are refused while any of its rows is
 * frozen: a form reopened by a later letter's return (16) is editable, but an earlier letter's rows stay at 5 / 7.
 * Single-row edits go through the claim-lock check instead.
 */
export async function assertNoFrozenDfRows(
  rowModel: Model<DevolutionFormulaRowDocument>,
  formId: Types.ObjectId,
  datasetVersion: number,
): Promise<void> {
  if (datasetVersion <= 0) return;
  const frozen = await rowModel
    .exists({ form: formId, datasetVersion, isActive: true, rowStatus: { $in: DF_FROZEN_ROW_STATUSES } })
    .exec();
  if (frozen) {
    throwXviFcValidationError({
      excelFile: [
        {
          field: 'excelFile',
          code: 'rowsLocked',
          message:
            'One or more rows are part of a claim letter that has been approved. Edit the remaining row(s) individually instead of replacing the file.',
        },
      ],
    });
  }
}

/**
 * Replacing the dataset would also replace the rows of ULBs in claim letters, drafts included: a draft keeps the
 * row and amount it was saved with, and saving it again with the same ULBs does not refresh them. So re-upload,
 * revalidate and delete are refused while any ULB of the installment holds a claim lock (claim-letter ADR 0009);
 * a returned row is fixed with a single-row edit, which `assertNoActiveClaimLockForUlb` allows once its ULB is free.
 */
export async function assertNoClaimLockedUlbs(
  lockModel: Model<ClaimLetterUlbLockDocument>,
  scope: { state: Types.ObjectId; year: Types.ObjectId; installment: number },
): Promise<void> {
  const locked = await lockModel.countDocuments({ ...scope, lockState: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } }).exec();
  if (!locked) return;
  throwXviFcValidationError({
    excelFile: [
      {
        field: 'excelFile',
        code: 'ulbsInClaimLetters',
        message:
          `${locked} ULB${locked > 1 ? 's' : ''} of this installment ${locked > 1 ? 'are' : 'is'} in claim letters, so the ` +
          "Devolution file can't be replaced. Edit the returned rows one by one, or discard the draft letters that hold " +
          'these ULBs.',
      },
    ],
  });
}

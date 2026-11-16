import type { Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { DevolutionFormulaRowDocument } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';

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

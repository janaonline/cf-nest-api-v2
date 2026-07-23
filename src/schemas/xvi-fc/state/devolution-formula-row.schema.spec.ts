import mongoose, { Types } from 'mongoose';
import { DevolutionFormulaRow, DevolutionFormulaRowSchema } from './devolution-formula-row.schema';

describe('DevolutionFormulaRowSchema — ulbName / devolutionFormula must be storable when blank', () => {
  // Regression test for a confirmed production bug: `required: true` (with no default) on a
  // String path is enforced by Mongoose even when the parsed value is an empty string (not just
  // null/undefined). `devolution-formula-excel.service.ts` always produces '' for a blank Excel
  // cell (never null/undefined), so `required: true` here silently dropped every row with a
  // blank Devolution Formula (or ULB Name) during `insertMany(rowDocs, { ordered: false })` —
  // rows that pass validation were inserted, invalid rows were silently discarded, with no error
  // surfaced to the caller. Business-level required-ness for both fields remains enforced by
  // DevolutionFormulaValidator.validateRow(), independent of this schema-level constraint.

  it('does not mark ulbName as required, so a blank ULB Name is storable', () => {
    const path = DevolutionFormulaRowSchema.path('ulbName');
    expect(path.isRequired).toBeFalsy();
  });

  it('defaults ulbName to an empty string', () => {
    const path = DevolutionFormulaRowSchema.path('ulbName') as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBe('');
  });

  it('does not mark devolutionFormula as required, so a blank Devolution Formula is storable', () => {
    const path = DevolutionFormulaRowSchema.path('devolutionFormula');
    expect(path.isRequired).toBeFalsy();
  });

  it('defaults devolutionFormula to an empty string', () => {
    const path = DevolutionFormulaRowSchema.path('devolutionFormula') as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBe('');
  });

  it('a row document with both fields blank (as produced by a blank Excel cell) passes schema validation', () => {
    // Use a distinct model name to avoid colliding with the real 'DevolutionFormulaRow' model
    // registered elsewhere in the process.
    const RowModel =
      (mongoose.models['__TestDevolutionFormulaRow'] as mongoose.Model<DevolutionFormulaRow> | undefined) ??
      mongoose.model<DevolutionFormulaRow>('__TestDevolutionFormulaRow', DevolutionFormulaRowSchema);

    const doc = new RowModel({
      form: new Types.ObjectId(),
      state: new Types.ObjectId(),
      year: new Types.ObjectId(),
      installment: 1,
      datasetVersion: 1,
      rowNumber: 1,
      ulbId: null,
      censusCode: '802685',
      ulbName: '', // blank Excel cell — must not fail schema validation
      totalGrantAllocation: 0,
      installment1Amount: 0,
      installment2Amount: 0,
      devolutionFormula: '', // blank Excel cell — must not fail schema validation
      validationStatus: 'INVALID',
      errors: [{ field: 'devolutionFormula', code: 'required', message: 'Devolution Formula is required.' }],
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
    });

    const validationError = doc.validateSync();
    expect(validationError).toBeUndefined();
  });
});

import mongoose, { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesRow, ElectedUrbanLocalBodiesRowSchema } from './elected-urban-local-bodies-row.schema';

describe('ElectedUrbanLocalBodiesRowSchema — ulbName must be storable when blank', () => {
  // Defense-in-depth regression test, mirroring devolution-formula-row.schema.spec.ts. This field
  // is currently inert (both EULB insertMany call sites pass `lean: true`, which bypasses Mongoose
  // document validation entirely), but the schema previously declared `required: true` with no
  // default — the exact shape that caused a confirmed data-loss bug in Devolution Formula's row
  // schema, where `insertMany(rowDocs, { ordered: false })` silently dropped every row with a blank
  // required String field. This test guards against a future refactor that drops `lean: true` and
  // reintroduces that failure mode here too.

  it('does not mark ulbName as required, so a blank ULB Name is storable', () => {
    const path = ElectedUrbanLocalBodiesRowSchema.path('ulbName');
    expect(path.isRequired).toBeFalsy();
  });

  it('defaults ulbName to an empty string', () => {
    const path = ElectedUrbanLocalBodiesRowSchema.path('ulbName') as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBe('');
  });

  it('a row document with ulbName blank (as produced by a blank Excel cell) passes schema validation', () => {
    const RowModel =
      (mongoose.models['__TestElectedUrbanLocalBodiesRow'] as mongoose.Model<ElectedUrbanLocalBodiesRow> | undefined) ??
      mongoose.model<ElectedUrbanLocalBodiesRow>('__TestElectedUrbanLocalBodiesRow', ElectedUrbanLocalBodiesRowSchema);

    const doc = new RowModel({
      form: new Types.ObjectId(),
      state: new Types.ObjectId(),
      year: new Types.ObjectId(),
      datasetVersion: 1,
      rowNumber: 1,
      ulbId: null,
      censusCode: '802685',
      ulbName: '', // blank Excel cell — must not fail schema validation
      rowType: 'DB_ULB',
      lastUpdatedSource: 'EXCEL',
      validationStatus: 'INVALID',
      errors: [{ field: 'ulbName', code: 'required', message: 'ULB Name is required.' }],
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
    });

    const validationError = doc.validateSync();
    expect(validationError).toBeUndefined();
  });
});

describe('ElectedUrbanLocalBodiesRowSchema indexes', () => {
  it('defines the unique partial index for active census codes in a design year', () => {
    const indexes = ElectedUrbanLocalBodiesRowSchema.indexes() as Array<
      [Record<string, unknown>, Record<string, unknown>]
    >;

    const target = indexes.find(([fields, opts]) => {
      const name = (opts as { name?: string }).name;
      return name === 'uniq_active_eulb_census_code_year' || (fields['year'] === 1 && fields['censusCode'] === 1);
    });

    expect(target).toBeDefined();

    const [fields, opts] = target!;
    expect(fields).toEqual({ year: 1, censusCode: 1 });
    expect(opts).toMatchObject({ unique: true });

    const partialFilterExpression = (opts as { partialFilterExpression?: Record<string, unknown> })
      .partialFilterExpression;
    expect(partialFilterExpression).toBeDefined();
    expect(partialFilterExpression).toMatchObject({ isActive: true });
    expect(partialFilterExpression!['censusCode']).toEqual({ $exists: true, $ne: '' });
  });
});

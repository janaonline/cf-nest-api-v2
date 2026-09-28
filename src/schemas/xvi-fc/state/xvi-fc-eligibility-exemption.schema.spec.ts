import mongoose, { Types } from 'mongoose';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionSchema,
} from './xvi-fc-eligibility-exemption.schema';

describe('XviFcEligibilityExemptionSchema — ulb nullability (whole-state branch)', () => {
  it('does not mark ulb as required, so a whole-state (ulb: null) document passes schema validation', () => {
    const path = XviFcEligibilityExemptionSchema.path('ulb');
    expect(path.isRequired).toBeFalsy();
  });

  it('defaults ulb to null', () => {
    const path = XviFcEligibilityExemptionSchema.path('ulb') as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBeNull();
  });

  it('a whole-state document (ulb: null) passes schema validation', () => {
    const Model =
      (mongoose.models['__TestXviFcEligibilityExemption'] as
        | mongoose.Model<XviFcEligibilityExemption>
        | undefined) ??
      mongoose.model<XviFcEligibilityExemption>('__TestXviFcEligibilityExemption', XviFcEligibilityExemptionSchema);

    const doc = new Model({
      state: new Types.ObjectId(),
      year: new Types.ObjectId(),
      ulb: null,
      data: [],
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
    });

    const validationError = doc.validateSync();
    expect(validationError).toBeUndefined();
  });
});

describe('XviFcEligibilityExemptionSchema indexes', () => {
  type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

  function indexes(): IndexEntry[] {
    return XviFcEligibilityExemptionSchema.indexes() as IndexEntry[];
  }

  it('defines a unique partial index scoping {ulb,year} to real-ULB documents only', () => {
    const target = indexes().find(([fields, opts]) => (opts as { name?: string }).name === 'uniq_ulb_year_exemption');
    expect(target).toBeDefined();

    const [fields, opts] = target!;
    expect(fields).toEqual({ ulb: 1, year: 1 });
    expect(opts).toMatchObject({ unique: true });
    expect((opts as { partialFilterExpression?: unknown }).partialFilterExpression).toEqual({
      ulb: { $type: 'objectId' },
    });
  });

  it('defines a unique partial index scoping {state,year} to whole-state (ulb: null) documents only', () => {
    const target = indexes().find(
      ([, opts]) => (opts as { name?: string }).name === 'uniq_state_year_exemption_no_ulb',
    );
    expect(target).toBeDefined();

    const [fields, opts] = target!;
    expect(fields).toEqual({ state: 1, year: 1 });
    expect(opts).toMatchObject({ unique: true });
    expect((opts as { partialFilterExpression?: unknown }).partialFilterExpression).toEqual({
      ulb: { $type: 'null' },
    });
  });

  it('also keeps the plain, non-unique {state,year} index that backs list()', () => {
    const target = indexes().find(
      ([fields, opts]) =>
        JSON.stringify(fields) === JSON.stringify({ state: 1, year: 1 }) && !(opts as { unique?: boolean }).unique,
    );
    expect(target).toBeDefined();
  });

  it('the two unique {state,year}-shaped indexes have mutually exclusive partial filters (never both match the same document)', () => {
    const ulbIndex = indexes().find(([, opts]) => (opts as { name?: string }).name === 'uniq_ulb_year_exemption')!;
    const stateIndex = indexes().find(
      ([, opts]) => (opts as { name?: string }).name === 'uniq_state_year_exemption_no_ulb',
    )!;

    const ulbFilter = (ulbIndex[1] as { partialFilterExpression: { ulb: { $type: string } } }).partialFilterExpression;
    const stateFilter = (stateIndex[1] as { partialFilterExpression: { ulb: { $type: string } } })
      .partialFilterExpression;

    expect(ulbFilter.ulb.$type).not.toEqual(stateFilter.ulb.$type);
  });
});

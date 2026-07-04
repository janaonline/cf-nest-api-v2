import { ElectedUrbanLocalBodiesRowSchema } from './elected-urban-local-bodies-row.schema';

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

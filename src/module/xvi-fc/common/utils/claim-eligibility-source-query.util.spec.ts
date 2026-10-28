import { Types } from 'mongoose';
import type { ClaimEligibilityConfig } from '../types/claim-eligibility.type';
import { buildClaimSourceQuery } from './claim-eligibility-source-query.util';

function config(overrides: Partial<ClaimEligibilityConfig> = {}): ClaimEligibilityConfig {
  return {
    yearScope: 'CURRENT_DESIGN_YEAR',
    source: {
      collection: 'xvifc_gtc',
      fields: { designYear: 'year', state: 'state', currentFormStatus: 'currentFormStatus', isActive: 'isActive' },
    },
    evaluator: { type: 'FORM_STATUS' },
    ...overrides,
  } as ClaimEligibilityConfig;
}

describe('buildClaimSourceQuery', () => {
  const stateId = new Types.ObjectId();
  const designYearId = new Types.ObjectId().toString();
  const ctx = { stateId, designYearId, installment: 2 };

  it('filters by the mapped state and design-year fields, plus any fixed match', () => {
    const query = buildClaimSourceQuery(
      config({ source: { ...config().source, match: { sectionType: 'audited' } } }),
      ctx,
    );
    expect(query).toEqual({ sectionType: 'audited', year: new Types.ObjectId(designYearId), state: stateId });
  });

  it('adds the installment when the evaluator config names an installment field', () => {
    const query = buildClaimSourceQuery(
      config({ evaluator: { type: 'FORM_STATUS', config: { installmentField: 'installment' } } }),
      ctx,
    );
    expect(query['installment']).toBe(2);
  });

  it('skips the design year for a submit-once source', () => {
    const query = buildClaimSourceQuery(config({ yearScope: 'SUBMISSION_PERIOD_SINGLETON' }), ctx);
    expect(query).not.toHaveProperty('year');
    expect(query['state']).toBe(stateId);
  });
});

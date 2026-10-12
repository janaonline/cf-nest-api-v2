import {
  FC_UNSPENT_POLICY_DEFAULTS_BY_FC,
  evaluateRowEligibility,
  policyThresholdPercent,
  resolveFcUnspentPolicy,
} from './fc-unspent-policy.helpers';

describe('resolveFcUnspentPolicy', () => {
  it('14th FC defaults: independent of Devolution, any unspent balance makes a ULB ineligible', () => {
    expect(resolveFcUnspentPolicy('14TH_FC')).toEqual({
      devolutionLinked: false,
      eligibilityRule: { type: 'NO_UNSPENT_ALLOWED' },
    });
  });

  it("15th FC defaults keep today's linked percent-of-allocation behaviour (threshold 0)", () => {
    expect(resolveFcUnspentPolicy('15TH_FC')).toEqual({
      devolutionLinked: true,
      eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 0 },
    });
  });

  it('the legacy meta.eligibilityThresholdPercent only feeds the percent rule', () => {
    expect(resolveFcUnspentPolicy('15TH_FC', { eligibilityThresholdPercent: 10 }).eligibilityRule).toEqual({
      type: 'MAX_PERCENT_OF_ALLOCATION',
      thresholdPercent: 10,
    });
    // The seeded 2026-27 payload carries a threshold of 0 and must still resolve to the 14th-FC rule.
    expect(resolveFcUnspentPolicy('14TH_FC', { eligibilityThresholdPercent: 0 })).toEqual(
      FC_UNSPENT_POLICY_DEFAULTS_BY_FC['14TH_FC'],
    );
  });

  it('meta.unspentPolicy overrides the FC-cycle default, so a year can change with config only', () => {
    expect(
      resolveFcUnspentPolicy('15TH_FC', {
        unspentPolicy: { devolutionLinked: false, eligibilityRule: { type: 'NO_UNSPENT_ALLOWED' } },
      }),
    ).toEqual({ devolutionLinked: false, eligibilityRule: { type: 'NO_UNSPENT_ALLOWED' } });

    expect(
      resolveFcUnspentPolicy('14TH_FC', {
        unspentPolicy: {
          devolutionLinked: true,
          eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 10 },
        },
      }),
    ).toEqual({ devolutionLinked: true, eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 10 } });
  });

  it('ignores malformed meta instead of throwing', () => {
    const malformed = [
      { unspentPolicy: 'nope' },
      { unspentPolicy: { devolutionLinked: 'yes' } },
      { unspentPolicy: { eligibilityRule: { type: 'SOMETHING_ELSE' } } },
      { unspentPolicy: { eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: -5 } } },
      { eligibilityThresholdPercent: -1 },
      { eligibilityThresholdPercent: 'ten' },
    ];
    for (const meta of malformed) {
      expect(resolveFcUnspentPolicy('14TH_FC', meta)).toEqual(FC_UNSPENT_POLICY_DEFAULTS_BY_FC['14TH_FC']);
      expect(resolveFcUnspentPolicy('15TH_FC', meta)).toEqual(FC_UNSPENT_POLICY_DEFAULTS_BY_FC['15TH_FC']);
    }
  });
});

describe('evaluateRowEligibility', () => {
  const noUnspent = { type: 'NO_UNSPENT_ALLOWED' } as const;

  it('NO_UNSPENT_ALLOWED follows the product truth table: eligible only when both balances are zero', () => {
    // 14th unspent | previous unspent | eligible?
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: 5, previousFcUnspentBalance: 5 }, null)).toBe(false); // T T
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: 5, previousFcUnspentBalance: 0 }, null)).toBe(false); // T F (pending: ineligible for now)
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: 0, previousFcUnspentBalance: 5 }, null)).toBe(false); // F T (pending: ineligible for now)
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: 0, previousFcUnspentBalance: 0 }, null)).toBe(true); // F F
  });

  it('MAX_PERCENT_OF_ALLOCATION keeps the original "<=" comparison', () => {
    const rule = { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 10 } as const;
    const row = { unspentAmount: 1, previousFcUnspentBalance: 1 };
    expect(evaluateRowEligibility(rule, row, 10)).toBe(true);
    expect(evaluateRowEligibility(rule, row, 10.01)).toBe(false);
  });

  it('MAX_PERCENT_OF_ALLOCATION without an allocation percent is ineligible', () => {
    const rule = { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 10 } as const;
    expect(evaluateRowEligibility(rule, { unspentAmount: 1, previousFcUnspentBalance: 1 }, null)).toBe(false);
  });

  it('a draft row with a figure not entered yet (null) is never eligible, under either rule', () => {
    const percent = { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 10 } as const;
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: null, previousFcUnspentBalance: null }, null)).toBe(
      false,
    );
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: 0, previousFcUnspentBalance: null }, null)).toBe(false);
    expect(evaluateRowEligibility(noUnspent, { unspentAmount: null, previousFcUnspentBalance: 0 }, null)).toBe(false);
    expect(evaluateRowEligibility(percent, { unspentAmount: 1, previousFcUnspentBalance: null }, 1)).toBe(false);
  });
});

describe('policyThresholdPercent', () => {
  it('is the rule threshold for the percent rule and 0 otherwise', () => {
    expect(policyThresholdPercent(resolveFcUnspentPolicy('14TH_FC'))).toBe(0);
    expect(policyThresholdPercent(resolveFcUnspentPolicy('15TH_FC', { eligibilityThresholdPercent: 10 }))).toBe(10);
  });
});

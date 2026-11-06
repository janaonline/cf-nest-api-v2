import {
  buildRejectedUlbsBody,
  CLAIM_LETTER_ULBS_REJECTED,
  ineligibleUlbsMessage,
  lockedUlbsMessage,
} from './claim-letter-rejected-ulbs.helpers';

describe('ineligibleUlbsMessage', () => {
  it('lists every code up to five', () => {
    expect(ineligibleUlbsMessage(['802345'])).toBe(
      '1 selected ULB is ineligible or has an invalid claimed amount: 802345.',
    );
    expect(ineligibleUlbsMessage(['a', 'b', 'c', 'd', 'e'])).toBe(
      '5 selected ULBs are ineligible or have an invalid claimed amount: a, b, c, d, e.',
    );
  });

  it('names only the first five past that', () => {
    const codes = Array.from({ length: 300 }, (_, i) => `c${i + 1}`);
    expect(ineligibleUlbsMessage(codes)).toBe(
      '300 selected ULBs are ineligible or have an invalid claimed amount, including c1, c2, c3, c4 and c5.',
    );
  });
});

describe('lockedUlbsMessage', () => {
  it('counts the locked rows', () => {
    expect(lockedUlbsMessage(1)).toBe('1 selected ULB is already locked in another active claim.');
    expect(lockedUlbsMessage(3)).toBe('3 selected ULBs are already locked in another active claim.');
  });
});

describe('buildRejectedUlbsBody', () => {
  it('keys each refused row by its request path, grouping entries for the same row and field', () => {
    expect(
      buildRejectedUlbsBody('Refused.', [
        { index: 3, field: 'ulbId', code: 'INELIGIBLE', message: 'a' },
        { index: 0, field: 'claimedAmount', code: 'INVALID_CLAIMED_AMOUNT', message: 'b' },
        { index: 3, field: 'ulbId', code: 'IN_ANOTHER_CLAIM', message: 'c' },
      ]),
    ).toEqual({
      message: 'Refused.',
      code: CLAIM_LETTER_ULBS_REJECTED,
      errors: {
        'ulbSelections.3.ulbId': [
          { field: 'ulbId', code: 'INELIGIBLE', message: 'a' },
          { field: 'ulbId', code: 'IN_ANOTHER_CLAIM', message: 'c' },
        ],
        'ulbSelections.0.claimedAmount': [{ field: 'claimedAmount', code: 'INVALID_CLAIMED_AMOUNT', message: 'b' }],
      },
    });
  });
});

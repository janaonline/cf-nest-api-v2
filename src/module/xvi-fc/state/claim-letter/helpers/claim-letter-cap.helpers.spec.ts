import {
  countOpenLetters,
  firstFreeBatchNumber,
  isLastDraft,
  openLettersFilter,
  ulbsLeftOutMessage,
} from './claim-letter-cap.helpers';

describe('claim letter cap helpers (ADR 0009)', () => {
  it('reads open letters as the ones not discarded or returned', () => {
    expect(openLettersFilter({ state: 's', year: 'y', installment: 1 })).toEqual({
      state: 's',
      year: 'y',
      installment: 1,
      isAbandoned: false,
    });
  });

  it('gives the lowest free place up to the cap, or null when all are taken', () => {
    // A returned letter freed slot 1 while 2 and 3 are still open.
    expect(firstFreeBatchNumber(new Set([2, 3]), 3)).toBe(1);
    expect(firstFreeBatchNumber(new Set([1, 2, 3]), 3)).toBeNull();
    expect(firstFreeBatchNumber(new Set([1, 2, 3]), 4)).toBe(4);
  });

  it('gives no place once open letters fill the cap, even after it is lowered below their numbers', () => {
    expect(firstFreeBatchNumber(new Set([2, 3, 4]), 3)).toBeNull();
    expect(firstFreeBatchNumber(new Set([3, 4]), 3)).toBe(1);
  });

  describe('countOpenLetters', () => {
    it('counts every open letter, and the drafts other than this one', () => {
      const letters = [
        { _id: 'this', currentFormStatus: 2 },
        { _id: 'a', currentFormStatus: 2 },
        { _id: 'b', currentFormStatus: 15 },
        { _id: 'c', currentFormStatus: 5 },
      ];

      expect(countOpenLetters(letters, 'this')).toEqual({ openLetterCount: 4, otherDraftCount: 1 });
    });
  });

  describe('isLastDraft', () => {
    it('is the last draft once every place is taken and no other draft is open', () => {
      expect(isLastDraft(3, 0, 3)).toBe(true);
    });

    it('is not while another draft is open, even over a lowered cap', () => {
      expect(isLastDraft(4, 3, 3)).toBe(false);
    });

    it('is not while a place is still free', () => {
      expect(isLastDraft(2, 0, 3)).toBe(false);
    });
  });

  it('names at most 10 ULBs left out', () => {
    const names = Array.from({ length: 12 }, (_, i) => `ULB ${i + 1}`);

    expect(ulbsLeftOutMessage(3, names)).toBe(
      'All 3 claim letters for this installment are in use and this is the last draft, so every ULB must be in a ' +
        'claim letter before it can be submitted. Not in any letter yet: ULB 1, ULB 2, ULB 3, ULB 4, ULB 5, ULB 6, ' +
        'ULB 7, ULB 8, ULB 9, ULB 10 and 2 more.',
    );
  });
});

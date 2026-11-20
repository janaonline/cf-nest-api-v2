import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { buildReturnSummary, isReturnedClaimLetter } from './claim-letter-returned.helpers';

describe('isReturnedClaimLetter', () => {
  it('is true for a letter returned by the SO (16) or by MoHUA (6)', () => {
    expect(isReturnedClaimLetter(FORM_STATUS.RETURNED_BY_SO)).toBe(true);
    expect(isReturnedClaimLetter(FORM_STATUS.RETURNED_BY_MOHUA)).toBe(true);
  });

  it('is false for every other status, and for no status', () => {
    for (const status of [
      FORM_STATUS.IN_PROGRESS,
      FORM_STATUS.UNDER_REVIEW_BY_SO,
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    ]) {
      expect(isReturnedClaimLetter(status)).toBe(false);
    }
    expect(isReturnedClaimLetter(null)).toBe(false);
    expect(isReturnedClaimLetter(undefined)).toBe(false);
  });
});

describe('buildReturnSummary', () => {
  const ref = (formId: number, ulbId: Types.ObjectId | null = null, row = false) => ({
    formId,
    ulbId,
    rowDocumentId: row ? new Types.ObjectId() : null,
  });

  it('is empty for a return with no refs', () => {
    expect(buildReturnSummary([], [])).toEqual({ stateForms: [], ulbs: [] });
  });

  it('counts the ULB rows a row form went back through', () => {
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()];
    const summary = buildReturnSummary([ref(35), ref(25, a, true), ref(25, b, true), ref(25)], []);

    expect(summary.stateForms).toEqual([
      { formId: 35, name: 'Grant Transfer Certificate', ulbCount: 0 },
      { formId: 25, name: 'FC Unspent Declaration', ulbCount: 2 },
    ]);
  });

  it('groups each ULB once, sorted by name, naming a rejected exemption as such', () => {
    const [zira, agra] = [new Types.ObjectId(), new Types.ObjectId()];
    const summary = buildReturnSummary(
      [ref(30, zira), ref(32, zira), ref(30, zira), ref(31, agra)],
      [
        { ulbId: zira, ulbSnapshot: { name: 'Zira' }, soDecision: { remark: 'Fix both' } },
        { ulbId: agra, ulbSnapshot: { name: 'Agra' }, soDecision: { remark: 'No', rejectExemptionFormIds: [31] } },
      ],
    );

    expect(summary.ulbs).toEqual([
      { ulbId: String(agra), ulbName: 'Agra', items: ['Annual Accounts (Provisional) exemption'], remark: 'No' },
      {
        ulbId: String(zira),
        ulbName: 'Zira',
        items: ['Annual Accounts (Audited)', 'Service Level Benchmarks'],
        remark: 'Fix both',
      },
    ]);
  });

  it('falls back to a plain name and no remark when the claim row is missing', () => {
    const ulb = new Types.ObjectId();

    expect(buildReturnSummary([ref(33, ulb)], []).ulbs).toEqual([
      { ulbId: String(ulb), ulbName: 'ULB', items: ['Bank Account'], remark: null },
    ]);
  });
});

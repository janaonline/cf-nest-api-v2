import { Types } from 'mongoose';
import { canUlbReuploadDocument, isAwaitingManualReviewDecision } from './annual-account-status-access.util';
import { FORM_STATUS } from '../../../../common/constants/form-status.constants';

describe('canUlbReuploadDocument', () => {
  it('is false when the section itself is not ULB-editable, regardless of document decision', () => {
    expect(canUlbReuploadDocument(FORM_STATUS.UNDER_REVIEW_BY_STATE, null)).toBe(false);
  });

  it('is true when the section is editable and the document has no decision yet', () => {
    expect(canUlbReuploadDocument(FORM_STATUS.IN_PROGRESS, null)).toBe(true);
    expect(canUlbReuploadDocument(FORM_STATUS.IN_PROGRESS, undefined)).toBe(true);
  });

  it('is false when the document is currently APPROVED — locked even if the section is open', () => {
    expect(
      canUlbReuploadDocument(FORM_STATUS.RETURNED_BY_STATE, {
        status: 'APPROVED',
        note: null,
        decidedBy: { userId: new Types.ObjectId(), role: 'STATE-EDITOR', ipAddress: null, userAgent: null },
        decidedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('is true when the document is currently RETURNED', () => {
    expect(
      canUlbReuploadDocument(FORM_STATUS.RETURNED_BY_STATE, {
        status: 'RETURNED',
        note: 'Fix the numbers',
        decidedBy: { userId: new Types.ObjectId(), role: 'STATE-EDITOR', ipAddress: null, userAgent: null },
        decidedAt: new Date(),
      }),
    ).toBe(true);
  });
});

describe('isAwaitingManualReviewDecision', () => {
  it('is false when no manual review has been requested', () => {
    expect(isAwaitingManualReviewDecision(false, null)).toBe(false);
    expect(isAwaitingManualReviewDecision(undefined, undefined)).toBe(false);
  });

  it('is true when requested and no decision has been recorded yet', () => {
    expect(isAwaitingManualReviewDecision(true, null)).toBe(true);
    expect(isAwaitingManualReviewDecision(true, undefined)).toBe(true);
  });

  it('is false once ADMIN has recorded a decision, regardless of status', () => {
    const decidedBy = { userId: new Types.ObjectId(), role: 'ADMIN', ipAddress: null, userAgent: null };
    expect(
      isAwaitingManualReviewDecision(true, { status: 'APPROVED', note: null, decidedBy, decidedAt: new Date() }),
    ).toBe(false);
    expect(
      isAwaitingManualReviewDecision(true, {
        status: 'RETURNED',
        note: 'Fix the numbers',
        decidedBy,
        decidedAt: new Date(),
      }),
    ).toBe(false);
  });
});

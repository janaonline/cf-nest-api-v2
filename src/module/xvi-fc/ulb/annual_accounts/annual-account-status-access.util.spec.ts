import { Types } from 'mongoose';
import { canUlbReuploadDocument } from './annual-account-status-access.util';
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

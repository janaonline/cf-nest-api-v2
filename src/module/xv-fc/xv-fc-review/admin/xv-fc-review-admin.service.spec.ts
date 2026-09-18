import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { XvFcReviewAdminService } from './xv-fc-review-admin.service';
import { LedgerLog } from '../../../../schemas/ledger-log.schema';
import { LineItem } from '../../../../schemas/line-item.schema';
import { Year } from '../../../../schemas/year.schema';
import { S3Service } from '../../../../core/s3/s3.service';
import type { AuthUser } from '../../../auth/auth-user.interface';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  chain['then'] = (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(onFulfilled, onRejected);
  return chain;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ulbOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const docOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'ADMIN',
  scope: 'ADMIN',
} as unknown as AuthUser;

const mockYear = { _id: yearOid, year: '2022-23' };

function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: docOid,
    ulb_id: ulbOid,
    ulb: 'Test ULB',
    ulb_code: 'ULB001',
    state: 'Test State',
    state_code: 'TS',
    year: '2022-23',
    lineItems: { '110': 4741268 },
    xvFcReview: {
      status: 'LOCKED',
      declaration: { file: { url: 'decl.pdf' } },
      supportingDocument: { url: 'support.pdf' },
      lineItemReviews: {
        '110': {
          flagged: true,
          proposedValue: 5000000,
          comment: 'looks low',
          adminDecision: { status: 'PENDING' },
        },
      },
    },
    ...overrides,
  };
}

describe('XvFcReviewAdminService', () => {
  let service: XvFcReviewAdminService;
  let ledgerLogModel: Record<string, jest.Mock>;
  let lineItemModel: Record<string, jest.Mock>;
  let yearModel: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;

  beforeEach(async () => {
    ledgerLogModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(baseDoc())),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      updateOne: jest.fn().mockReturnValue(q({ modifiedCount: 1 })),
    };
    lineItemModel = {
      find: jest.fn().mockReturnValue(q([{ code: '110', name: 'Tax Revenue', headOfAccount: 'Revenue' }])),
    };
    yearModel = {
      findById: jest.fn().mockReturnValue(q(mockYear)),
      find: jest.fn().mockReturnValue(q([mockYear])),
    };
    s3Service = { presignGet: jest.fn().mockResolvedValue('https://signed-url') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XvFcReviewAdminService,
        { provide: getModelToken(LedgerLog.name), useValue: ledgerLogModel },
        { provide: getModelToken(LineItem.name), useValue: lineItemModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get(XvFcReviewAdminService);
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('only returns ledgerlogs docs that actually have a review started (xvFcReview not null)', async () => {
      await service.list({});
      const filterArg = ledgerLogModel.find.mock.calls[0][0];
      expect(filterArg).toMatchObject({ xvFcReview: { $ne: null } });
    });

    it('applies stateId/financialYear/reviewStatus/search filters when provided', async () => {
      await service.list({
        stateId: 'TS',
        financialYear: '2022-23',
        reviewStatus: 'LOCKED',
        search: 'Test',
      } as never);
      const filterArg = ledgerLogModel.find.mock.calls[0][0];
      expect(filterArg).toMatchObject({
        state_code: 'TS',
        year: '2022-23',
        'xvFcReview.status': 'LOCKED',
      });
      expect(filterArg['$or']).toBeDefined();
    });

    it('applies a partial-match censusCode filter when provided', async () => {
      await service.list({ censusCode: '8005' } as never);
      const filterArg = ledgerLogModel.find.mock.calls[0][0];
      expect((filterArg['censusCode'] as RegExp).test('800563')).toBe(true);
    });
  });

  // ─── getYearsSummary ─────────────────────────────────────────────────────

  describe('getYearsSummary', () => {
    it('returns every reviewable year, defaulting to NOT_STARTED where no ledgerlogs doc exists', async () => {
      ledgerLogModel.find.mockReturnValue(q([{ year: '2022-23', xvFcReview: { status: 'LOCKED' } }]));
      const result = await service.getYearsSummary(ulbOid.toString());
      expect(result).toHaveLength(5);
      expect(result.find((r) => r.financialYear === '2022-23')).toMatchObject({ status: 'LOCKED' });
      expect(result.find((r) => r.financialYear === '2019-20')).toMatchObject({ status: 'NOT_STARTED' });
    });

    it('resolves yearId to null for a reviewable year with no matching Year document', async () => {
      yearModel.find.mockReturnValue(q([]));
      const result = await service.getYearsSummary(ulbOid.toString());
      expect(result.every((r) => r.yearId === null)).toBe(true);
    });
  });

  // ─── getDetail ───────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('rejects a yearId outside the reviewable range', async () => {
      yearModel.findById.mockReturnValue(q({ _id: yearOid, year: '2017-18' }));
      await expect(service.getDetail(ulbOid.toString(), yearOid.toString())).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when no ledgerlogs doc exists for this ulb+year', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(null));
      await expect(service.getDetail(ulbOid.toString(), yearOid.toString())).rejects.toThrow(NotFoundException);
    });

    it('surfaces proposedValue distinctly from comment for a flagged line item', async () => {
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString());
      expect(result.lineItems[0]).toMatchObject({
        code: '110',
        flagged: true,
        proposedValue: 5000000,
        comment: 'looks low',
      });
    });

    it('sorts the OTHERS sub-section (31001/31002) to the end, after every other code including numerically larger ones', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(baseDoc({ lineItems: { '460': 1, '33104': 2, '31001': 3, '31002': 4 } })),
      );
      lineItemModel.find.mockReturnValue(
        q([
          { code: '460', name: 'Loans, Advances and Deposits', headOfAccount: 'Asset' },
          { code: '33104', name: 'Bonds and Other Debt Instruments', headOfAccount: 'Debt' },
          { code: '31001', name: 'Municipal (General) Fund', headOfAccount: 'Tax' },
          { code: '31002', name: 'Rounding off differences', headOfAccount: 'Tax' },
        ]),
      );
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString());
      expect(result.lineItems.map((li: { code: string }) => li.code)).toEqual(['460', '33104', '31001', '31002']);
    });

    it('surfaces the full auditTrail, filterable client-side by lineItemCode — same shape as Ptax’s `history`', async () => {
      const entry = { action: 'ADMIN_ACCEPT', lineItemCode: '110', reason: '' };
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { auditTrail: [entry] } })));
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString());
      expect(result.auditTrail).toEqual([entry]);
    });
  });

  // ─── decideLineItem ──────────────────────────────────────────────────────

  describe('decideLineItem', () => {
    it('rejects a code the ULB never flagged', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(baseDoc({ xvFcReview: { lineItemReviews: { '110': { flagged: false } } } })),
      );
      await expect(
        service.decideLineItem(
          ulbOid.toString(),
          yearOid.toString(),
          '110',
          { decision: 'REJECTED', reason: 'x' } as never,
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates the corrected value into lineItems.<code> in the same atomic write on ACCEPT', async () => {
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'ACCEPTED', reason: 'verified', correctedValue: 5000000 } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['lineItems.110']).toBe(5000000);
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision.status']).toBe('ACCEPTED');
    });

    it('does not touch lineItems.<code> on REJECT', async () => {
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'REJECTED', reason: 'does not match records' } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['lineItems.110']).toBeUndefined();
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision.status']).toBe('REJECTED');
    });

    it('allows ACCEPT with no correctedValue — a flagged item with no proposed value has nothing to overwrite', async () => {
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'ACCEPTED', reason: '' } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['lineItems.110']).toBeUndefined();
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision.correctedValue']).toBeUndefined();
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision.status']).toBe('ACCEPTED');
    });

    it('records the real previousValue/newValue in the audit trail entry', async () => {
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'ACCEPTED', reason: 'verified', correctedValue: 5000000 } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const auditEntry = (updateArg as { $push: { 'xvFcReview.auditTrail': Record<string, unknown> } }).$push[
        'xvFcReview.auditTrail'
      ];
      expect(auditEntry).toMatchObject({ action: 'ADMIN_ACCEPT', previousValue: 4741268, newValue: 5000000 });
    });

    it('surfaces a concurrency conflict when the write unexpectedly matches nothing (modifiedCount 0)', async () => {
      ledgerLogModel.updateOne.mockReturnValue(q({ modifiedCount: 0 }));
      await expect(
        service.decideLineItem(
          ulbOid.toString(),
          yearOid.toString(),
          '110',
          { decision: 'ACCEPTED', reason: 'x', correctedValue: 5000000 } as never,
          adminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows re-deciding a line item that was already decided (e.g. ACCEPTED → REJECTED) before Final Submit', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseDoc({
            xvFcReview: {
              status: 'VERIFYING',
              lineItemReviews: { '110': { flagged: true, adminDecision: { status: 'ACCEPTED' } } },
            },
          }),
        ),
      );
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'REJECTED', reason: 'x' } as never,
        adminUser,
      );
      const [filterArg, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      // No adminDecision.status clause in the filter — the write applies regardless of the
      // line item's current decision state.
      expect(filterArg).toEqual({ _id: docOid });
      expect(
        (updateArg as { $set: Record<string, unknown> }).$set['xvFcReview.lineItemReviews.110.adminDecision.status'],
      ).toBe('REJECTED');
    });

    it('rejects deciding on an already-finalized submission', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { status: 'APPROVED', lineItemReviews: {} } })));
      await expect(
        service.decideLineItem(
          ulbOid.toString(),
          yearOid.toString(),
          '110',
          { decision: 'REJECTED', reason: 'x' } as never,
          adminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('bumps status from LOCKED to VERIFYING on the first decision — Final Submit (not this) resolves it', async () => {
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'ACCEPTED', reason: 'x', correctedValue: 5000000 } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.status']).toBe('VERIFYING');
    });

    it('leaves status untouched when already past LOCKED (e.g. already VERIFYING)', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { ...baseDoc().xvFcReview, status: 'VERIFYING' } })));
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'ACCEPTED', reason: 'x', correctedValue: 5000000 } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.status']).toBeUndefined();
    });

    it('defaults reason to an empty string on ACCEPT when omitted', async () => {
      await service.decideLineItem(
        ulbOid.toString(),
        yearOid.toString(),
        '110',
        { decision: 'ACCEPTED', correctedValue: 5000000 } as never,
        adminUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision.reason']).toBe('');
    });
  });

  // ─── acceptAll ───────────────────────────────────────────────────────────

  describe('acceptAll', () => {
    it('bulk-accepts every pending flagged line item using its proposedValue, and bumps status to VERIFYING', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseDoc({
            lineItems: { '110': 100, '120': 50, '130': 10 },
            xvFcReview: {
              status: 'LOCKED',
              lineItemReviews: {
                '110': { flagged: true, proposedValue: 200, adminDecision: { status: 'PENDING' } },
                '120': { flagged: true, proposedValue: 60, adminDecision: { status: 'ACCEPTED' } },
                '130': { flagged: false, adminDecision: null },
              },
            },
          }),
        ),
      );

      await service.acceptAll(ulbOid.toString(), yearOid.toString(), adminUser);

      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision.status']).toBe('ACCEPTED');
      expect(setOps['lineItems.110']).toBe(200);
      expect(setOps['xvFcReview.lineItemReviews.120.adminDecision.status']).toBeUndefined(); // already decided
      expect(setOps['xvFcReview.lineItemReviews.130.adminDecision.status']).toBeUndefined(); // never flagged
      expect(setOps['xvFcReview.status']).toBe('VERIFYING');
    });

    it('is a no-op (no write) when nothing is pending', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseDoc({
            xvFcReview: { lineItemReviews: { '110': { flagged: true, adminDecision: { status: 'ACCEPTED' } } } },
          }),
        ),
      );
      await service.acceptAll(ulbOid.toString(), yearOid.toString(), adminUser);
      expect(ledgerLogModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects when the submission is already finalized', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { status: 'APPROVED' } })));
      await expect(service.acceptAll(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── finalize ────────────────────────────────────────────────────────────

  describe('finalize', () => {
    it('rejects when a flagged line item is still PENDING', async () => {
      await expect(service.finalize(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when a rejected line item has no reason recorded', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseDoc({
            xvFcReview: {
              lineItemReviews: { '110': { flagged: true, adminDecision: { status: 'REJECTED', reason: '' } } },
            },
          }),
        ),
      );
      await expect(service.finalize(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resolves to APPROVED when every flagged line item was accepted', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseDoc({
            xvFcReview: { lineItemReviews: { '110': { flagged: true, adminDecision: { status: 'ACCEPTED' } } } },
          }),
        ),
      );
      await service.finalize(ulbOid.toString(), yearOid.toString(), adminUser);
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: { 'xvFcReview.status': string } }).$set['xvFcReview.status']).toBe('APPROVED');
    });

    it('resolves to REJECTED when any flagged line item was rejected (with a reason)', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseDoc({
            xvFcReview: {
              lineItemReviews: {
                '110': { flagged: true, adminDecision: { status: 'ACCEPTED' } },
                '120': { flagged: true, adminDecision: { status: 'REJECTED', reason: 'bad value' } },
              },
            },
          }),
        ),
      );
      await service.finalize(ulbOid.toString(), yearOid.toString(), adminUser);
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: { 'xvFcReview.status': string } }).$set['xvFcReview.status']).toBe('REJECTED');
    });

    it('rejects when the submission is already finalized', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { status: 'REJECTED' } })));
      await expect(service.finalize(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── reopen ──────────────────────────────────────────────────────────────

  describe('reopen', () => {
    it('moves an APPROVED submission back to DRAFT with a REOPENED audit entry', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { status: 'APPROVED' } })));
      await service.reopen(ulbOid.toString(), yearOid.toString(), { reason: 'please recheck' }, adminUser);
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: { 'xvFcReview.status': string } }).$set['xvFcReview.status']).toBe('DRAFT');
      const auditEntry = (updateArg as { $push: { 'xvFcReview.auditTrail': Record<string, unknown> } }).$push[
        'xvFcReview.auditTrail'
      ];
      expect(auditEntry).toMatchObject({ action: 'REOPENED', reason: 'please recheck' });
    });

    it('rejects reopening a submission that is not currently finalized', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { status: 'VERIFYING' } })));
      await expect(service.reopen(ulbOid.toString(), yearOid.toString(), {}, adminUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── getSignedUrl ────────────────────────────────────────────────────────

  describe('getSignedUrl', () => {
    it('rejects an unknown targetCode', async () => {
      await expect(service.getSignedUrl(ulbOid.toString(), yearOid.toString(), 'BOGUS')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the requested document was never uploaded', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseDoc({ xvFcReview: { declaration: null } })));
      await expect(service.getSignedUrl(ulbOid.toString(), yearOid.toString(), 'DECLARATION')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

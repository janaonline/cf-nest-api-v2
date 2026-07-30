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
    yearModel = { findById: jest.fn().mockReturnValue(q(mockYear)) };
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

    it('surfaces a concurrency conflict when another admin already decided this item (modifiedCount 0)', async () => {
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

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PtaxReviewAdminService } from './ptax-review-admin.service';
import { XvFcPtaxReview } from '../../../schemas/xv-fc-ptax-review.schema';
import { S3Service } from '../../../core/s3/s3.service';
import type { AuthUser } from '../../../module/auth/auth-user.interface';

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
const reviewOid = new Types.ObjectId();

const adminUser: AuthUser = { _id: new Types.ObjectId().toString(), role: 'ADMIN', scope: 'ADMIN' } as unknown as AuthUser;

function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: reviewOid,
    ulb_id: ulbOid,
    year_id: yearOid,
    financialYear: '2022-23',
    status: 'SUBMITTED',
    metricReviews: {
      '1_9': {
        value: '121.22',
        flagged: true,
        proposedValue: 200,
        comment: 'looks off',
        adminDecision: { status: 'PENDING' },
      },
    },
    declaration: { file: { url: 'decl.pdf' } },
    supportingDocument: { url: 'support.pdf' },
    history: [],
    ...overrides,
  };
}

describe('PtaxReviewAdminService', () => {
  let service: PtaxReviewAdminService;
  let reviewModel: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(baseDoc())),
      findById: jest.fn().mockReturnValue(q(baseDoc())),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      updateOne: jest.fn().mockReturnValue(q({ modifiedCount: 1 })),
    };
    s3Service = { presignGet: jest.fn().mockResolvedValue('https://signed-url') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtaxReviewAdminService,
        { provide: getModelToken(XvFcPtaxReview.name), useValue: reviewModel },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get(PtaxReviewAdminService);
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('defaults to excluding DRAFT/NOT_STARTED — only actually-submitted rows are visible to admin', async () => {
      await service.list({});
      const filterArg = reviewModel.find.mock.calls[0][0];
      expect(filterArg).toMatchObject({ status: { $in: ['SUBMITTED', 'REJECTED', 'APPROVED'] } });
    });

    it('overrides the default filter when a specific reviewStatus is requested', async () => {
      await service.list({ reviewStatus: 'APPROVED' } as never);
      const filterArg = reviewModel.find.mock.calls[0][0];
      expect(filterArg.status).toBe('APPROVED');
    });
  });

  // ─── decideMetric ────────────────────────────────────────────────────────

  describe('decideMetric', () => {
    it('rejects a metric the ULB never flagged', async () => {
      reviewModel.findOne.mockReturnValue(
        q(baseDoc({ metricReviews: { '1_9': { flagged: false } } })),
      );
      await expect(
        service.decideMetric(ulbOid.toString(), yearOid.toString(), '1.9', { decision: 'REJECTED', reason: 'x' }, adminUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a metric that is not currently PENDING (already decided)', async () => {
      reviewModel.findOne.mockReturnValue(
        q(baseDoc({ metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } } } })),
      );
      await expect(
        service.decideMetric(ulbOid.toString(), yearOid.toString(), '1.9', { decision: 'REJECTED', reason: 'x' }, adminUser),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a correctedValue outside the metric bounds', async () => {
      await expect(
        service.decideMetric(
          ulbOid.toString(),
          yearOid.toString(),
          '1.9',
          { decision: 'ACCEPTED', reason: 'x', correctedValue: 99_999_999 },
          adminUser,
        ),
      ).rejects.toThrow(/must not exceed/);
    });

    it('rejects a correctedValue that would violate cross-field order against another metric\'s current value', async () => {
      // 1.10 (lesser) already has a cached value of 300; accepting 1.9 (greater) at 100 would violate 1.10<=1.9.
      reviewModel.findOne.mockReturnValue(
        q(
          baseDoc({
            metricReviews: {
              '1_9': { value: '121.22', flagged: true, adminDecision: { status: 'PENDING' } },
              '1_10': { value: '300', flagged: false, adminDecision: null },
            },
          }),
        ),
      );
      await expect(
        service.decideMetric(
          ulbOid.toString(),
          yearOid.toString(),
          '1.9',
          { decision: 'ACCEPTED', reason: 'x', correctedValue: 100 },
          adminUser,
        ),
      ).rejects.toThrow(/cannot be greater than metric 1.9/);
    });

    it('propagates the corrected value into the metric\'s `value` field as a string on ACCEPT', async () => {
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: 'verified', correctedValue: 250 },
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.value']).toBe('250');
      expect(setOps['metricReviews.1_9.adminDecision.correctedValue']).toBe(250);
    });

    it('does not touch `value` on REJECT — only the admin decision fields', async () => {
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'REJECTED', reason: 'does not match records' },
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.value']).toBeUndefined();
      expect(setOps['metricReviews.1_9.adminDecision.status']).toBe('REJECTED');
    });

    it('records the real previousValue in the history entry, parsed from the cached string value', async () => {
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: 'verified', correctedValue: 250 },
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const historyEntry = (updateArg as { $push: { history: Record<string, unknown> } }).$push.history;
      expect(historyEntry).toMatchObject({ action: 'ADMIN_ACCEPT', previousValue: 121.22, newValue: 250 });
    });

    it('surfaces a concurrency conflict when another admin already decided this metric (modifiedCount 0)', async () => {
      reviewModel.updateOne.mockReturnValue(q({ modifiedCount: 0 }));
      await expect(
        service.decideMetric(
          ulbOid.toString(),
          yearOid.toString(),
          '1.9',
          { decision: 'ACCEPTED', reason: 'x', correctedValue: 200 },
          adminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('recomputes the aggregate status to REJECTED when any decided metric was rejected', async () => {
      reviewModel.findById.mockReturnValue(
        q(
          baseDoc({
            status: 'SUBMITTED',
            metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'REJECTED' } } },
          }),
        ),
      );

      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'REJECTED', reason: 'x' },
        adminUser,
      );

      const statusUpdateCall = reviewModel.updateOne.mock.calls.find(
        ([, arg]) => (arg as { $set?: { status?: string } }).$set?.status === 'REJECTED',
      );
      expect(statusUpdateCall).toBeDefined();
    });

    it('recomputes the aggregate status to APPROVED once every flagged metric is accepted', async () => {
      reviewModel.findById.mockReturnValue(
        q(
          baseDoc({
            status: 'SUBMITTED',
            metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } } },
          }),
        ),
      );

      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: 'x', correctedValue: 200 },
        adminUser,
      );

      const statusUpdateCall = reviewModel.updateOne.mock.calls.find(
        ([, arg]) => (arg as { $set?: { status?: string } }).$set?.status === 'APPROVED',
      );
      expect(statusUpdateCall).toBeDefined();
    });

    it('leaves the aggregate status untouched (no extra update) while other metrics are still PENDING', async () => {
      reviewModel.findById.mockReturnValue(
        q(
          baseDoc({
            status: 'SUBMITTED',
            metricReviews: {
              '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } },
              '1_10': { flagged: true, adminDecision: { status: 'PENDING' } },
            },
          }),
        ),
      );

      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: 'x', correctedValue: 200 },
        adminUser,
      );

      // Only the primary decision updateOne call — no second status-changing call.
      expect(reviewModel.updateOne).toHaveBeenCalledTimes(1);
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
      reviewModel.findOne.mockReturnValue(q(baseDoc({ supportingDocument: null })));
      await expect(
        service.getSignedUrl(ulbOid.toString(), yearOid.toString(), 'SUPPORTING_DOCUMENT'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

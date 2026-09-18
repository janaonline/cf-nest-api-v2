import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PtaxReviewAdminService } from './ptax-review-admin.service';
import { XvFcPtaxReview } from '../../../../../schemas/xv-fc-ptax-review.schema';
import { Year } from '../../../../../schemas/year.schema';
import { S3Service } from '../../../../../core/s3/s3.service';
import type { AuthUser } from '../../../../auth/auth-user.interface';

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

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'ADMIN',
  scope: 'ADMIN',
} as unknown as AuthUser;

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
  let yearModel: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(baseDoc())),
      findById: jest.fn().mockReturnValue(q(baseDoc())),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      updateOne: jest.fn().mockReturnValue(q({ modifiedCount: 1 })),
    };
    yearModel = { find: jest.fn().mockReturnValue(q([{ _id: yearOid, year: '2022-23' }])) };
    s3Service = { presignGet: jest.fn().mockResolvedValue('https://signed-url') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtaxReviewAdminService,
        { provide: getModelToken(XvFcPtaxReview.name), useValue: reviewModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get(PtaxReviewAdminService);
  });

  // ─── getYearsSummary ─────────────────────────────────────────────────────

  describe('getYearsSummary', () => {
    // Ptax's reviewable window is 6 years (2018-19 through 2023-24) — one year earlier than
    // AFS's 5-year window (2019-20 through 2023-24); PTAX_REVIEWABLE_YEARS, not
    // XV_FC_REVIEWABLE_YEARS.
    it('returns every reviewable year (all 6, starting 2018-19), defaulting to NOT_STARTED where no review doc exists', async () => {
      reviewModel.find.mockReturnValue(q([{ financialYear: '2022-23', status: 'SUBMITTED' }]));
      const result = await service.getYearsSummary(ulbOid.toString());
      expect(result).toHaveLength(6);
      expect(result.map((r) => r.financialYear)).toEqual([
        '2018-19',
        '2019-20',
        '2020-21',
        '2021-22',
        '2022-23',
        '2023-24',
      ]);
      expect(result.find((r) => r.financialYear === '2022-23')).toMatchObject({ status: 'SUBMITTED' });
      expect(result.find((r) => r.financialYear === '2018-19')).toMatchObject({ status: 'NOT_STARTED' });
    });
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
      reviewModel.findOne.mockReturnValue(q(baseDoc({ metricReviews: { '1_9': { flagged: false } } })));
      await expect(
        service.decideMetric(
          ulbOid.toString(),
          yearOid.toString(),
          '1.9',
          { decision: 'REJECTED', reason: 'x' },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows re-deciding a metric that was already decided (e.g. ACCEPTED → REJECTED) before Final Submit', async () => {
      reviewModel.findOne.mockReturnValue(
        q(baseDoc({ metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } } } })),
      );
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'REJECTED', reason: 'x' },
        adminUser,
      );
      const [filterArg, updateArg] = reviewModel.updateOne.mock.calls[0];
      // No adminDecision.status clause in the filter — the write applies regardless of the
      // metric's current decision state.
      expect(filterArg).toEqual({ _id: reviewOid });
      expect((updateArg as { $set: Record<string, unknown> }).$set['metricReviews.1_9.adminDecision.status']).toBe(
        'REJECTED',
      );
    });

    it('rejects deciding on an already-finalized submission', async () => {
      reviewModel.findOne.mockReturnValue(q(baseDoc({ status: 'APPROVED' })));
      await expect(
        service.decideMetric(
          ulbOid.toString(),
          yearOid.toString(),
          '1.9',
          { decision: 'REJECTED', reason: 'x' },
          adminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows ACCEPT with no correctedValue — a flagged metric with no value has nothing to record', async () => {
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: '' },
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.value']).toBeUndefined();
      expect(setOps['metricReviews.1_9.adminDecision.correctedValue']).toBeUndefined();
      expect(setOps['metricReviews.1_9.adminDecision.status']).toBe('ACCEPTED');
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

    it("rejects a correctedValue that would violate cross-field order against another metric's current value", async () => {
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

    it("propagates the corrected value into the metric's `value` field as a string on ACCEPT", async () => {
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

    it('bumps status from SUBMITTED to VERIFYING on the first decision — finalize (not auto-recompute) resolves it', async () => {
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: 'x', correctedValue: 200 },
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['status']).toBe('VERIFYING');
    });

    it('leaves status untouched when already past SUBMITTED (e.g. already VERIFYING)', async () => {
      reviewModel.findOne.mockReturnValue(q(baseDoc({ status: 'VERIFYING' })));
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', reason: 'x', correctedValue: 200 },
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['status']).toBeUndefined();
    });

    it('defaults reason to an empty string on ACCEPT when omitted', async () => {
      await service.decideMetric(
        ulbOid.toString(),
        yearOid.toString(),
        '1.9',
        { decision: 'ACCEPTED', correctedValue: 200 } as never,
        adminUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.adminDecision.reason']).toBe('');
    });
  });

  // ─── acceptAll ───────────────────────────────────────────────────────────

  describe('acceptAll', () => {
    it('bulk-accepts every pending flagged metric using its proposedValue, and bumps status to VERIFYING', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          baseDoc({
            status: 'SUBMITTED',
            metricReviews: {
              '1_9': { value: '100', flagged: true, proposedValue: 200, adminDecision: { status: 'PENDING' } },
              '1_10': { value: '50', flagged: true, proposedValue: 60, adminDecision: { status: 'ACCEPTED' } },
              '1_11': { value: '10', flagged: false, adminDecision: null },
            },
          }),
        ),
      );

      await service.acceptAll(ulbOid.toString(), yearOid.toString(), adminUser);

      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.adminDecision.status']).toBe('ACCEPTED');
      expect(setOps['metricReviews.1_9.value']).toBe('200');
      expect(setOps['metricReviews.1_10.adminDecision.status']).toBeUndefined(); // already decided, untouched
      expect(setOps['metricReviews.1_11.adminDecision.status']).toBeUndefined(); // never flagged
      expect(setOps['status']).toBe('VERIFYING');
    });

    it('is a no-op (no write) when nothing is pending', async () => {
      reviewModel.findOne.mockReturnValue(
        q(baseDoc({ metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } } } })),
      );
      await service.acceptAll(ulbOid.toString(), yearOid.toString(), adminUser);
      expect(reviewModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects when the submission is already finalized', async () => {
      reviewModel.findOne.mockReturnValue(q(baseDoc({ status: 'APPROVED' })));
      await expect(service.acceptAll(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── finalize ────────────────────────────────────────────────────────────

  describe('finalize', () => {
    it('rejects when a flagged metric is still PENDING', async () => {
      await expect(service.finalize(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when a rejected metric has no reason recorded', async () => {
      reviewModel.findOne.mockReturnValue(
        q(baseDoc({ metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'REJECTED', reason: '' } } } })),
      );
      await expect(service.finalize(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resolves to APPROVED when every flagged metric was accepted', async () => {
      reviewModel.findOne.mockReturnValue(
        q(baseDoc({ metricReviews: { '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } } } })),
      );
      await service.finalize(ulbOid.toString(), yearOid.toString(), adminUser);
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: { status: string } }).$set.status).toBe('APPROVED');
    });

    it('resolves to REJECTED when any flagged metric was rejected (with a reason)', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          baseDoc({
            metricReviews: {
              '1_9': { flagged: true, adminDecision: { status: 'ACCEPTED' } },
              '1_10': { flagged: true, adminDecision: { status: 'REJECTED', reason: 'bad value' } },
            },
          }),
        ),
      );
      await service.finalize(ulbOid.toString(), yearOid.toString(), adminUser);
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: { status: string } }).$set.status).toBe('REJECTED');
    });

    it('rejects when the submission is already finalized', async () => {
      reviewModel.findOne.mockReturnValue(q(baseDoc({ status: 'REJECTED' })));
      await expect(service.finalize(ulbOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── reopen ──────────────────────────────────────────────────────────────

  describe('reopen', () => {
    it('moves an APPROVED submission back to DRAFT with a REOPENED history entry', async () => {
      reviewModel.findOne.mockReturnValue(q(baseDoc({ status: 'APPROVED' })));
      await service.reopen(ulbOid.toString(), yearOid.toString(), { reason: 'please recheck' }, adminUser);
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: { status: string } }).$set.status).toBe('DRAFT');
      expect((updateArg as { $push: { history: Record<string, unknown> } }).$push.history).toMatchObject({
        action: 'REOPENED',
        reason: 'please recheck',
      });
    });

    it('rejects reopening a submission that is not currently finalized', async () => {
      reviewModel.findOne.mockReturnValue(q(baseDoc({ status: 'VERIFYING' })));
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
      reviewModel.findOne.mockReturnValue(q(baseDoc({ supportingDocument: null })));
      await expect(service.getSignedUrl(ulbOid.toString(), yearOid.toString(), 'SUPPORTING_DOCUMENT')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

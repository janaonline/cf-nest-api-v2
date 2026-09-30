import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PtaxReviewService } from './ptax-review.service';
import { XvFcPtaxReview } from '../../../../../schemas/xv-fc-ptax-review.schema';
import { PropertyTaxOpMapper } from '../../../../../schemas/property-tax-op-mapper.schema';
import { Ulb } from '../../../../../schemas/ulb.schema';
import { State } from '../../../../../schemas/state.schema';
import { Year } from '../../../../../schemas/year.schema';
import { S3Service } from '../../../../../core/s3/s3.service';
import { S3UploadService } from '../../../../file/s3-upload.service';
import type { AuthUser } from '../../../../auth/auth-user.interface';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Chainable Mongoose Query-like mock, mirrors the pattern used across the codebase. */
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
const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const reviewOid = new Types.ObjectId();

const ulbUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'ULB',
  scope: 'ULB',
  ulb: ulbOid,
} as unknown as AuthUser;

const mockYear = { _id: yearOid, year: '2022-23' };
const mockUlb = { _id: ulbOid, name: 'Test ULB', code: 'TC001', state: stateOid };
const mockState = { _id: stateOid, name: 'Test State', code: 'TS' };

function freshReviewDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: reviewOid,
    ulb_id: ulbOid,
    year_id: yearOid,
    financialYear: '2022-23',
    status: 'NOT_STARTED',
    metricReviews: {},
    declaration: null,
    supportingDocument: null,
    submissionCount: 0,
    history: [],
    ...overrides,
  };
}

describe('PtaxReviewService', () => {
  let service: PtaxReviewService;
  let reviewModel: Record<string, jest.Mock>;
  let mapperModel: Record<string, jest.Mock>;
  let yearModel: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;
  let s3UploadService: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(freshReviewDoc())),
      findOneAndUpdate: jest.fn().mockReturnValue(q(freshReviewDoc())),
      updateOne: jest.fn().mockReturnValue(q({ modifiedCount: 1 })),
    };
    mapperModel = {
      find: jest.fn().mockReturnValue(q([])),
      aggregate: jest.fn().mockReturnValue(q([])),
    };
    const ulbModel = { findById: jest.fn().mockReturnValue(q(mockUlb)) };
    const stateModel = { findById: jest.fn().mockReturnValue(q(mockState)) };
    yearModel = {
      find: jest.fn().mockReturnValue(q([mockYear])),
      findById: jest.fn().mockReturnValue(q(mockYear)),
    };
    s3Service = {
      headObject: jest.fn().mockResolvedValue({ ContentLength: 1000 }),
      presignGet: jest.fn().mockResolvedValue('https://signed-url'),
    };
    s3UploadService = {
      generatePutSignedUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://put-url', path: 'xv-fc-review/ptax/x/y/DECLARATION/file.pdf' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtaxReviewService,
        { provide: getModelToken(XvFcPtaxReview.name), useValue: reviewModel },
        { provide: getModelToken(PropertyTaxOpMapper.name), useValue: mapperModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: S3Service, useValue: s3Service },
        { provide: S3UploadService, useValue: s3UploadService },
      ],
    }).compile();

    service = module.get(PtaxReviewService);
  });

  // ─── access control ──────────────────────────────────────────────────────

  it('rejects a ULB-scope user reading data for a different ULB', async () => {
    const otherUlbUser = { ...ulbUser, ulb: new Types.ObjectId() } as AuthUser;
    await expect(service.getSummary(ulbOid.toString(), otherUlbUser)).rejects.toThrow(ForbiddenException);
  });

  // ─── getSummary ──────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('always returns all 6 reviewable years, each carrying its yearId', async () => {
      const result = await service.getSummary(ulbOid.toString(), ulbUser);
      expect(result).toHaveLength(6);
      expect(result.map((r) => r.financialYear)).toEqual([
        '2018-19',
        '2019-20',
        '2020-21',
        '2021-22',
        '2022-23',
        '2023-24',
      ]);
    });

    it('marks hasData false for a year with no matching Year document', async () => {
      yearModel.find.mockReturnValue(q([])); // no years resolve at all
      const result = await service.getSummary(ulbOid.toString(), ulbUser);
      expect(result.every((r) => r.hasData === false && r.yearId === null)).toBe(true);
    });
  });

  // ─── getDetail — read-through cache ──────────────────────────────────────

  describe('getDetail', () => {
    it('fetches from propertytaxopmappers and persists the value when nothing is cached yet', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc()));
      mapperModel.find.mockReturnValue(q([{ displayPriority: '1.9', value: '121.22' }]));

      const result = await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);

      expect(mapperModel.find).toHaveBeenCalled();
      expect(reviewModel.updateOne).toHaveBeenCalledWith(
        { _id: reviewOid },
        { $set: { 'metricReviews.1_9.value': '121.22' } },
      );
      const item = result.metrics.find((m) => m.code === '1.9');
      expect(item?.value).toBe('121.22');
    });

    it('reads the cached value and never re-queries propertytaxopmappers once every metric is cached', async () => {
      const cachedReviews: Record<string, unknown> = {};
      for (const key of ['1_9', '1_10', '1_17', '1_18', '2_3', '2_4', '1_12', '1_20']) {
        cachedReviews[key] = { value: '100', flagged: false, comment: '' };
      }
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ metricReviews: cachedReviews })));

      await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);

      expect(mapperModel.find).not.toHaveBeenCalled();
      expect(reviewModel.updateOne).not.toHaveBeenCalled();
    });

    it('exposes the per-metric validation rule and the cross-field order rules for FE binding', async () => {
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);
      const item = result.metrics.find((m) => m.code === '1.9');
      expect(item?.validation).toEqual({ min: 0, max: 9999999, decimalLimit: 2, isRupee: true });
      expect(result.metricOrderRules).toEqual(expect.arrayContaining([{ greater: '1.9', lesser: '1.10' }]));
    });

    it('rejects a yearId outside the reviewable range', async () => {
      yearModel.findById.mockReturnValue(q({ _id: yearOid, year: '2017-18' }));
      await expect(service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for an unknown yearId', async () => {
      yearModel.findById.mockReturnValue(q(null));
      await expect(service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── saveDraft ───────────────────────────────────────────────────────────

  describe('saveDraft', () => {
    it('rejects a proposedValue outside the metric bounds', async () => {
      await expect(
        service.saveDraft(
          ulbOid.toString(),
          yearOid.toString(),
          { metrics: [{ code: '1.9', flagged: true, proposedValue: 99_999_999 }] },
          ulbUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the merged state violates a cross-field order rule against an already-stored value', async () => {
      reviewModel.findOne.mockReturnValue(
        q(freshReviewDoc({ metricReviews: { '1_9': { proposedValue: 50, flagged: true } } })),
      );

      await expect(
        service.saveDraft(
          ulbOid.toString(),
          yearOid.toString(),
          { metrics: [{ code: '1.10', flagged: true, proposedValue: 999 }] },
          ulbUser,
        ),
      ).rejects.toThrow(/cannot be greater than metric 1.9/);
    });

    it('writes to the dot-safe sanitized key, not the raw dotted code', async () => {
      await service.saveDraft(
        ulbOid.toString(),
        yearOid.toString(),
        { metrics: [{ code: '1.9', flagged: true, proposedValue: 100, comment: 'test' }] },
        ulbUser,
      );

      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      // toHaveProperty would itself interpret the dots as a nested-path lookup
      // (the exact footgun this key-sanitization exists to avoid) — assert on
      // the literal flat key instead.
      expect(setOps['metricReviews.1_9.flagged']).toBe(true);
      expect(setOps['metricReviews.1_9.proposedValue']).toBe(100);
      expect(setOps['metricReviews.1_9.comment']).toBe('test');
      expect(Object.keys(setOps).some((k) => k.includes('.1.9.'))).toBe(false);
    });

    it('rejects edits once the submission is SUBMITTED (awaiting admin review)', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ status: 'SUBMITTED' })));
      await expect(service.saveDraft(ulbOid.toString(), yearOid.toString(), { metrics: [] }, ulbUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects edits once APPROVED (final)', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ status: 'APPROVED' })));
      await expect(service.saveDraft(ulbOid.toString(), yearOid.toString(), { metrics: [] }, ulbUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows edits while REJECTED — the resubmission loop depends on this', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ status: 'REJECTED' })));
      await expect(
        service.saveDraft(
          ulbOid.toString(),
          yearOid.toString(),
          { metrics: [{ code: '1.9', flagged: true, proposedValue: 100 }] },
          ulbUser,
        ),
      ).resolves.toBeDefined();
    });

    it('resets a stale ACCEPTED decision back to PENDING when the ULB changes the accepted proposedValue', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            status: 'DRAFT',
            metricReviews: {
              '1_9': {
                flagged: true,
                proposedValue: 100,
                comment: 'old',
                adminDecision: { status: 'ACCEPTED', correctedValue: 100 },
              },
            },
          }),
        ),
      );
      await service.saveDraft(
        ulbOid.toString(),
        yearOid.toString(),
        { metrics: [{ code: '1.9', flagged: true, proposedValue: 150, comment: 'old' }] },
        ulbUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.adminDecision']).toMatchObject({ status: 'PENDING' });
    });

    it('leaves an ACCEPTED decision untouched when the resubmitted data is unchanged', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            status: 'DRAFT',
            metricReviews: {
              '1_9': {
                flagged: true,
                proposedValue: 100,
                comment: 'same',
                adminDecision: { status: 'ACCEPTED', correctedValue: 100 },
              },
            },
          }),
        ),
      );
      await service.saveDraft(
        ulbOid.toString(),
        yearOid.toString(),
        { metrics: [{ code: '1.9', flagged: true, proposedValue: 100, comment: 'same' }] },
        ulbUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.adminDecision']).toBeUndefined();
    });
  });

  // ─── presign / confirm uploads ───────────────────────────────────────────

  describe('presignUpload / confirmUpload', () => {
    it('rejects an unknown targetCode', async () => {
      await expect(
        service.presignUpload(
          ulbOid.toString(),
          yearOid.toString(),
          { targetCode: 'BOGUS', fileName: 'a.pdf', fileSize: 100 } as never,
          ulbUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-PDF file', async () => {
      await expect(
        service.presignUpload(
          ulbOid.toString(),
          yearOid.toString(),
          { targetCode: 'DECLARATION', fileName: 'a.docx', fileSize: 100 },
          ulbUser,
        ),
      ).rejects.toThrow(/PDF/);
    });

    it('rejects a confirm whose s3Key does not match the expected prefix', async () => {
      await expect(
        service.confirmUpload(
          ulbOid.toString(),
          yearOid.toString(),
          {
            uploadId: '123e4567-e89b-12d3-a456-426614174000',
            s3Key: 'wrong/prefix/file.pdf',
            targetCode: 'DECLARATION',
            originalName: 'a.pdf',
            fileSize: 100,
          },
          ulbUser,
        ),
      ).rejects.toThrow(/Invalid s3Key/);
    });

    it('rejects when the uploaded object cannot be found in S3', async () => {
      s3Service.headObject.mockRejectedValue(new Error('not found'));
      const uploadId = '123e4567-e89b-12d3-a456-426614174000';
      const key = `xv-fc-review/ptax/${ulbOid.toString()}/${yearOid.toString()}/DECLARATION/${uploadId}.pdf`;
      await expect(
        service.confirmUpload(
          ulbOid.toString(),
          yearOid.toString(),
          { uploadId, s3Key: key, targetCode: 'DECLARATION', originalName: 'a.pdf', fileSize: 100 },
          ulbUser,
        ),
      ).rejects.toThrow(/upload may have failed/);
    });

    it('rejects a confirm whose s3Key does not match the caller-supplied uploadId', async () => {
      const uploadId = '123e4567-e89b-12d3-a456-426614174000';
      const key = `xv-fc-review/ptax/${ulbOid.toString()}/${yearOid.toString()}/DECLARATION/some-other-file.pdf`;
      await expect(
        service.confirmUpload(
          ulbOid.toString(),
          yearOid.toString(),
          { uploadId, s3Key: key, targetCode: 'DECLARATION', originalName: 'a.pdf', fileSize: 100 },
          ulbUser,
        ),
      ).rejects.toThrow(/Invalid s3Key/);
    });

    it('rejects a confirm when the actual S3 object exceeds the 20MB limit, regardless of the claimed fileSize', async () => {
      s3Service.headObject.mockResolvedValue({ ContentLength: 21 * 1024 * 1024 });
      const uploadId = '123e4567-e89b-12d3-a456-426614174000';
      const key = `xv-fc-review/ptax/${ulbOid.toString()}/${yearOid.toString()}/DECLARATION/${uploadId}.pdf`;
      await expect(
        service.confirmUpload(
          ulbOid.toString(),
          yearOid.toString(),
          // Client lies about fileSize — only the real S3 ContentLength must matter
          { uploadId, s3Key: key, targetCode: 'DECLARATION', originalName: 'a.pdf', fileSize: 100 },
          ulbUser,
        ),
      ).rejects.toThrow(/exceeds the 20MB limit/);
    });

    it('stores a confirmed DECLARATION upload under `declaration`, not `supportingDocument`', async () => {
      const uploadId = '123e4567-e89b-12d3-a456-426614174000';
      const key = `xv-fc-review/ptax/${ulbOid.toString()}/${yearOid.toString()}/DECLARATION/${uploadId}.pdf`;
      await service.confirmUpload(
        ulbOid.toString(),
        yearOid.toString(),
        { uploadId, s3Key: key, targetCode: 'DECLARATION', originalName: 'a.pdf', fileSize: 100 },
        ulbUser,
      );
      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      expect(updateArg).toMatchObject({ $set: { declaration: expect.objectContaining({ file: expect.any(Object) }) } });
    });
  });

  // ─── submit ──────────────────────────────────────────────────────────────

  describe('submit', () => {
    it('requires a declaration before either final action', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ declaration: null })));
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'ACCEPT_NO_CHANGES' }, ulbUser),
      ).rejects.toThrow(/signed declaration/);
    });

    it('rejects ACCEPT_NO_CHANGES when metrics are still flagged', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            declaration: { file: { url: 'x' } },
            metricReviews: { '1_9': { flagged: true, proposedValue: 100 } },
          }),
        ),
      );
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'ACCEPT_NO_CHANGES' }, ulbUser),
      ).rejects.toThrow(/unflag them first/);
    });

    it('ACCEPT_NO_CHANGES with nothing flagged sets status to APPROVED directly (auto-approve, no admin review)', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ declaration: { file: { url: 'x' } } })));
      await service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'ACCEPT_NO_CHANGES' }, ulbUser);

      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      expect((updateArg as { $set: Record<string, unknown> }).$set).toMatchObject({ status: 'APPROVED' });
    });

    it('rejects SUBMIT_WITH_COMMENTS when nothing is flagged', async () => {
      reviewModel.findOne.mockReturnValue(q(freshReviewDoc({ declaration: { file: { url: 'x' } } })));
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser),
      ).rejects.toThrow(/must be flagged/);
    });

    it('rejects SUBMIT_WITH_COMMENTS when a flagged metric has no proposedValue', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            declaration: { file: { url: 'x' } },
            metricReviews: { '1_9': { flagged: true, proposedValue: null } },
          }),
        ),
      );
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser),
      ).rejects.toThrow(/requires a proposed value/);
    });

    it('allows SUBMIT_WITH_COMMENTS when the shared supporting document is missing — optional for Ptax', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            declaration: { file: { url: 'x' } },
            supportingDocument: null,
            metricReviews: { '1_9': { flagged: true, proposedValue: 100 } },
          }),
        ),
      );
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser),
      ).resolves.toBeDefined();
    });

    it('resets a previously-REJECTED metric back to PENDING on resubmit, leaves ACCEPTED ones untouched', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            declaration: { file: { url: 'x' } },
            supportingDocument: { url: 'y' },
            metricReviews: {
              '1_9': {
                flagged: true,
                proposedValue: 100,
                adminDecision: { status: 'REJECTED' },
              },
              '1_10': {
                flagged: true,
                proposedValue: 50,
                adminDecision: { status: 'ACCEPTED', correctedValue: 50 },
              },
            },
          }),
        ),
      );

      await service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser);

      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['metricReviews.1_9.adminDecision']).toBeDefined();
      expect((setOps['metricReviews.1_9.adminDecision'] as { status: string }).status).toBe('PENDING');
      expect(setOps['metricReviews.1_10.adminDecision']).toBeUndefined();
    });

    it('increments submissionCount on every successful submit', async () => {
      reviewModel.findOne.mockReturnValue(
        q(
          freshReviewDoc({
            declaration: { file: { url: 'x' } },
            supportingDocument: { url: 'y' },
            metricReviews: { '1_9': { flagged: true, proposedValue: 100 } },
          }),
        ),
      );

      await service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser);

      const [, updateArg] = reviewModel.updateOne.mock.calls[0];
      expect(updateArg).toMatchObject({ $inc: { submissionCount: 1 } });
    });
  });
});

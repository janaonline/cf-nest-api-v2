import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { XvFcReviewService } from './xv-fc-review.service';
import { LedgerLog } from '../../../../schemas/ledger-log.schema';
import { LineItem } from '../../../../schemas/line-item.schema';
import { AnnualAccountData } from '../../../../schemas/annual-account-data.schema';
import { Year } from '../../../../schemas/year.schema';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../file/s3-upload.service';
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

const ulbUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'ULB',
  scope: 'ULB',
  ulb: ulbOid,
} as unknown as AuthUser;

const mockYear = { _id: yearOid, year: '2022-23' };

function baseLedgerLog(overrides: Record<string, unknown> = {}) {
  return {
    _id: docOid,
    ulb_id: ulbOid,
    ulb: 'Test ULB',
    year: '2022-23',
    lineItems: { '110': 4741268 },
    excel_url: null,
    xvFcReview: null,
    ...overrides,
  };
}

describe('XvFcReviewService', () => {
  let service: XvFcReviewService;
  let ledgerLogModel: Record<string, jest.Mock>;
  let lineItemModel: Record<string, jest.Mock>;
  let annualAccountModel: Record<string, jest.Mock>;
  let yearModel: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;
  let s3UploadService: Record<string, jest.Mock>;

  beforeEach(async () => {
    ledgerLogModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(baseLedgerLog())),
      updateOne: jest.fn().mockReturnValue(q({ modifiedCount: 1 })),
    };
    lineItemModel = {
      find: jest.fn().mockReturnValue(q([{ code: '110', name: 'Tax Revenue', headOfAccount: 'Revenue' }])),
    };
    annualAccountModel = { find: jest.fn().mockReturnValue(q([])) };
    yearModel = {
      find: jest.fn().mockReturnValue(q([mockYear])),
      findOne: jest.fn().mockReturnValue(q(mockYear)),
      findById: jest.fn().mockReturnValue(q(mockYear)),
    };
    s3Service = {
      headObject: jest.fn().mockResolvedValue({ ContentLength: 1000 }),
      presignGet: jest.fn().mockResolvedValue('https://signed-url'),
    };
    s3UploadService = {
      generatePutSignedUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://put-url', path: 'xv-fc-review/x/y/DECLARATION/file.pdf' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XvFcReviewService,
        { provide: getModelToken(LedgerLog.name), useValue: ledgerLogModel },
        { provide: getModelToken(LineItem.name), useValue: lineItemModel },
        { provide: getModelToken(AnnualAccountData.name), useValue: annualAccountModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: S3Service, useValue: s3Service },
        { provide: S3UploadService, useValue: s3UploadService },
      ],
    }).compile();

    service = module.get(XvFcReviewService);
  });

  // ─── access control ──────────────────────────────────────────────────────

  it('rejects a ULB-scope user reading data for a different ULB', async () => {
    const otherUlbUser = { ...ulbUser, ulb: new Types.ObjectId() } as AuthUser;
    await expect(service.getSummary(ulbOid.toString(), otherUlbUser)).rejects.toThrow(ForbiddenException);
  });

  // ─── getSummary ──────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('always returns all 5 reviewable years, each carrying its yearId', async () => {
      const result = await service.getSummary(ulbOid.toString(), ulbUser);
      expect(result).toHaveLength(5);
      expect(result.map((r) => r.financialYear)).toEqual(['2019-20', '2020-21', '2021-22', '2022-23', '2023-24']);
    });
  });

  // ─── yearId resolution ───────────────────────────────────────────────────

  describe('year resolution', () => {
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

  // ─── getDetail ───────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('returns a graceful "not started" shape (not a 404) when no ledgerlogs doc exists for this ulb+year', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(null));
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);
      expect(result).toMatchObject({ hasData: false, status: 'NOT_STARTED', lineItems: [] });
    });

    it('joins line items against the master catalog and maps headOfAccount to a display section', async () => {
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);
      expect(result.lineItems[0]).toMatchObject({
        code: '110',
        name: 'Tax Revenue',
        headOfAccount: 'Revenue',
        section: 'INCOME',
        standardizedAmount: 4741268,
      });
    });

    it('sorts the OTHERS sub-section (31001/31002) to the end, after every other code including numerically larger ones', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            lineItems: { '460': 1, '33104': 2, '31001': 3, '31002': 4 },
          }),
        ),
      );
      lineItemModel.find.mockReturnValue(
        q([
          { code: '460', name: 'Loans, Advances and Deposits', headOfAccount: 'Asset' },
          { code: '33104', name: 'Bonds and Other Debt Instruments', headOfAccount: 'Debt' },
          { code: '31001', name: 'Municipal (General) Fund', headOfAccount: 'Tax' },
          { code: '31002', name: 'Rounding off differences', headOfAccount: 'Tax' },
        ]),
      );
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);
      expect(result.lineItems.map((li) => li.code)).toEqual(['460', '33104', '31001', '31002']);
    });

    it('surfaces proposedValue distinctly from comment on a flagged line item', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              lineItemReviews: { '110': { flagged: true, proposedValue: 5000000, comment: 'verified' } },
            },
          }),
        ),
      );
      const result = await service.getDetail(ulbOid.toString(), yearOid.toString(), ulbUser);
      expect(result.lineItems[0]).toMatchObject({ flagged: true, proposedValue: 5000000, comment: 'verified' });
    });
  });

  // ─── saveDraft ───────────────────────────────────────────────────────────

  describe('saveDraft', () => {
    it('rejects edits once LOCKED', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseLedgerLog({ xvFcReview: { status: 'LOCKED' } })));
      await expect(
        service.saveDraft(ulbOid.toString(), yearOid.toString(), { lineItems: [] }, ulbUser),
      ).rejects.toThrow(ConflictException);
    });

    it('writes flagged/proposedValue/comment for the given code without mangling numeric-only codes', async () => {
      await service.saveDraft(
        ulbOid.toString(),
        yearOid.toString(),
        { lineItems: [{ code: '110', flagged: true, proposedValue: 5000000, comment: 'test' }] },
        ulbUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.lineItemReviews.110.flagged']).toBe(true);
      expect(setOps['xvFcReview.lineItemReviews.110.proposedValue']).toBe(5000000);
      expect(setOps['xvFcReview.lineItemReviews.110.comment']).toBe('test');
    });

    it('resets a stale ACCEPTED decision back to PENDING when the ULB changes the accepted proposedValue', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              status: 'DRAFT',
              lineItemReviews: {
                '110': {
                  flagged: true,
                  proposedValue: 5000000,
                  comment: 'old',
                  adminDecision: { status: 'ACCEPTED', correctedValue: 5000000 },
                },
              },
            },
          }),
        ),
      );
      await service.saveDraft(
        ulbOid.toString(),
        yearOid.toString(),
        { lineItems: [{ code: '110', flagged: true, proposedValue: 6000000, comment: 'old' }] },
        ulbUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision']).toMatchObject({ status: 'PENDING' });
    });

    it('leaves an ACCEPTED decision untouched when the resubmitted data is unchanged', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              status: 'DRAFT',
              lineItemReviews: {
                '110': {
                  flagged: true,
                  proposedValue: 5000000,
                  comment: 'same',
                  adminDecision: { status: 'ACCEPTED', correctedValue: 5000000 },
                },
              },
            },
          }),
        ),
      );
      await service.saveDraft(
        ulbOid.toString(),
        yearOid.toString(),
        { lineItems: [{ code: '110', flagged: true, proposedValue: 5000000, comment: 'same' }] },
        ulbUser,
      );
      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.lineItemReviews.110.adminDecision']).toBeUndefined();
    });
  });

  // ─── confirmUpload ───────────────────────────────────────────────────────

  describe('confirmUpload', () => {
    it('rejects a confirm when the actual S3 object exceeds the 20MB limit, regardless of the claimed fileSize', async () => {
      s3Service.headObject.mockResolvedValue({ ContentLength: 21 * 1024 * 1024 });
      const uploadId = '123e4567-e89b-12d3-a456-426614174000';
      const key = `xv-fc-review/${ulbOid.toString()}/${yearOid.toString()}/DECLARATION/${uploadId}.pdf`;
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
  });

  // ─── submit ──────────────────────────────────────────────────────────────

  describe('submit', () => {
    it('requires a declaration before either final action', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseLedgerLog({ xvFcReview: { declaration: null } })));
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'ACCEPT_NO_CHANGES' }, ulbUser),
      ).rejects.toThrow(/signed declaration/);
    });

    it('rejects ACCEPT_NO_CHANGES while items remain flagged', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              declaration: { file: { url: 'x' } },
              lineItemReviews: { '110': { flagged: true, proposedValue: 100 } },
            },
          }),
        ),
      );
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'ACCEPT_NO_CHANGES' }, ulbUser),
      ).rejects.toThrow(/unflag them first/);
    });

    it('rejects SUBMIT_WITH_COMMENTS when a flagged item has no proposedValue', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              declaration: { file: { url: 'x' } },
              lineItemReviews: { '110': { flagged: true, proposedValue: null } },
            },
          }),
        ),
      );
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser),
      ).rejects.toThrow(/requires a proposed value/);
    });

    it('rejects SUBMIT_WITH_COMMENTS when the shared supporting document is missing', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              declaration: { file: { url: 'x' } },
              supportingDocument: null,
              lineItemReviews: { '110': { flagged: true, proposedValue: 100 } },
            },
          }),
        ),
      );
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser),
      ).rejects.toThrow(/supporting document/);
    });

    it('rejects edits/resubmission once already LOCKED — AFS has no reject-and-resubmit cycle', async () => {
      ledgerLogModel.findOne.mockReturnValue(q(baseLedgerLog({ xvFcReview: { status: 'LOCKED' } })));
      await expect(
        service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'ACCEPT_NO_CHANGES' }, ulbUser),
      ).rejects.toThrow(ConflictException);
    });

    it('records the real previousValue/newValue in the audit trail for each flagged line item', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            lineItems: { '110': 4741268 },
            xvFcReview: {
              declaration: { file: { url: 'x' } },
              supportingDocument: { url: 'y' },
              lineItemReviews: { '110': { flagged: true, proposedValue: 5000000, comment: 'looks low' } },
            },
          }),
        ),
      );

      await service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser);

      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const auditEntries = (updateArg as { $push: { 'xvFcReview.auditTrail': { $each: Record<string, unknown>[] } } })
        .$push['xvFcReview.auditTrail'].$each;
      expect(auditEntries[0]).toMatchObject({
        action: 'ULB_FLAG',
        lineItemCode: '110',
        previousValue: 4741268,
        newValue: 5000000,
        reason: 'looks low',
      });
    });

    it('locks the record and initializes adminDecision to PENDING for every flagged item', async () => {
      ledgerLogModel.findOne.mockReturnValue(
        q(
          baseLedgerLog({
            xvFcReview: {
              declaration: { file: { url: 'x' } },
              supportingDocument: { url: 'y' },
              lineItemReviews: { '110': { flagged: true, proposedValue: 100, comment: 'x' } },
            },
          }),
        ),
      );

      await service.submit(ulbOid.toString(), yearOid.toString(), { finalAction: 'SUBMIT_WITH_COMMENTS' }, ulbUser);

      const [, updateArg] = ledgerLogModel.updateOne.mock.calls[0];
      const setOps = (updateArg as { $set: Record<string, unknown> }).$set;
      expect(setOps['xvFcReview.status']).toBe('LOCKED');
      expect((setOps['xvFcReview.lineItemReviews.110.adminDecision'] as { status: string }).status).toBe('PENDING');
    });
  });
});

import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { S3Service } from 'src/core/s3/s3.service';
import type { FormJsonService } from 'src/master/form-json/form-json.service';
import type { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import type { ClaimLetterFormJsonService, ClaimLetterMergeDocument } from '../form-json/claim-letter-form-json.service';
import {
  ClaimLetterFinalPdfService,
  FINAL_PDF_INCOMPLETE,
  FINAL_PDF_OUTDATED,
  FINAL_PDF_SOURCE_UNREADABLE,
} from './claim-letter-final-pdf.service';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

async function pdfWithPages(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

const MERGE_DOCUMENTS: ClaimLetterMergeDocument[] = [
  { label: 'Copy of Elected Body', formId: 23, fileKeys: ['signedElectedbodyFile'], optional: false },
  { label: 'Copy of GTC', formId: 35, fileKeys: ['i2GtcFile'], optional: false },
  {
    label: 'Signed Unspent Balance Declaration',
    formId: 25,
    fileKeys: ['fcDeclaration', 'fcUnspentDeclaration'],
    optional: false,
  },
  { label: 'Other Supporting Documents (ATR)', formId: 22, fileKeys: ['atrReport'], optional: true },
];

const SOURCE_FIELDS = {
  designYear: 'year',
  state: 'state',
  currentFormStatus: 'currentFormStatus',
  isActive: 'isActive',
};

/** Each enclosure form's own claimEligibility, as in the payload: the merge finds documents through it. */
function eligibilitySource(formId: number, collection: string, displayLabel: string, installmentField?: string) {
  return {
    formId,
    claimEligibility: {
      enabled: true,
      yearScope: 'CURRENT_DESIGN_YEAR',
      displayLabel,
      source: { collection, fields: SOURCE_FIELDS },
      evaluator: { type: 'FORM_STATUS', ...(installmentField && { config: { installmentField } }) },
    },
  };
}

const ELIGIBILITY_SOURCES = [
  eligibilitySource(22, 'xvifc_sfc', 'State Finance Commission (SFC)'),
  eligibilitySource(23, 'xvifc_elected_ulb_forms', 'Elected Body Constitution'),
  eligibilitySource(25, 'xvifc_unspent_state_forms', '14th FC Unspent Balance Declaration'),
  eligibilitySource(35, 'xvifc_gtc', 'Grant Transfer Certificate', 'installment'),
];

describe('ClaimLetterFinalPdfService', () => {
  const stateOid = new Types.ObjectId();
  const claimLetterId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
    state: String(stateOid),
  } as AuthUser;

  let parent: Record<string, unknown>;
  let formDocs: Record<string, Record<string, unknown> | null>;
  let files: Record<string, Buffer>;
  let findOneCalls: { collection: string; filter: Record<string, unknown> }[];
  let s3: { getPdfBufferFromS3: jest.Mock; uploadPrivate: jest.Mock };
  let batchModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let activeBatch: { assertActive: jest.Mock };
  let formJsonService: { findEnabledClaimEligibilitySources: jest.Mock };
  let service: ClaimLetterFinalPdfService;

  beforeEach(async () => {
    parent = {
      _id: new Types.ObjectId(claimLetterId),
      state: stateOid,
      year: new Types.ObjectId(),
      installment: 1,
      batchNumber: 2,
      currentFormStatus: 2,
      isAbandoned: false,
      signedClaimFile: { path: 'signed/letter.pdf' },
      finalClaimPdf: null,
    };
    formDocs = {
      xvifc_elected_ulb_forms: { signedElectedbodyFile: { path: 'eb/list.pdf' } },
      xvifc_gtc: { data: { i2GtcFile: { path: 'gtc/i2.pdf' } } },
      xvifc_unspent_state_forms: { fcDeclaration: null, fcUnspentDeclaration: { path: 'fc/yes.pdf' } },
      xvifc_sfc: { data: {} },
    };
    files = {
      'signed/letter.pdf': await pdfWithPages(3),
      'eb/list.pdf': await pdfWithPages(2),
      'gtc/i2.pdf': await pdfWithPages(1),
      'fc/yes.pdf': await pdfWithPages(1),
    };
    findOneCalls = [];
    const connection = {
      collection: (name: string) => ({
        findOne: jest.fn((filter: Record<string, unknown>) => {
          findOneCalls.push({ collection: name, filter });
          return Promise.resolve(formDocs[name] ?? null);
        }),
      }),
    };
    s3 = {
      getPdfBufferFromS3: jest.fn((path: string) =>
        files[path] ? Promise.resolve(files[path]) : Promise.reject(new Error('S3 GetObject failed')),
      ),
      uploadPrivate: jest.fn().mockResolvedValue('key'),
    };
    batchModel = {
      findOne: jest.fn(() => q(parent)),
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) })),
    };
    activeBatch = { assertActive: jest.fn().mockResolvedValue(undefined) };
    const formJson = { loadFormConfig: jest.fn().mockResolvedValue({ mergeDocuments: MERGE_DOCUMENTS }) };
    formJsonService = { findEnabledClaimEligibilitySources: jest.fn().mockResolvedValue(ELIGIBILITY_SOURCES) };
    const stateModel = { findById: jest.fn(() => q({ name: 'Sample State' })) };

    service = new ClaimLetterFinalPdfService(
      formJson as unknown as ClaimLetterFormJsonService,
      formJsonService as unknown as FormJsonService,
      activeBatch as unknown as ClaimLetterActiveBatchService,
      s3 as unknown as S3Service,
      connection as never,
      batchModel as never,
      stateModel as never,
    );
  });

  async function caught(promise: Promise<unknown>): Promise<HttpException> {
    try {
      await promise;
    } catch (err) {
      return err as HttpException;
    }
    throw new Error('expected a rejection');
  }

  function savedFinalPdf(): Record<string, unknown> {
    const [, update] = batchModel.updateOne.mock.calls[0] as [
      unknown,
      { $set: { finalClaimPdf: Record<string, unknown> } },
    ];
    return update.$set.finalClaimPdf;
  }

  it('merges the signed letter then each document in order and caches the result', async () => {
    const { data } = await service.getFinalPdf(claimLetterId, user);

    expect(data).toMatchObject({
      included: ['Signed claim letter', 'Copy of Elected Body', 'Copy of GTC', 'Signed Unspent Balance Declaration'],
      missing: ['Other Supporting Documents (ATR)'],
      pageCount: 7,
    });
    expect(data!.fileName).toMatch(/^CF_Sample-State_Claim-letter-1-2(_[\d-]+)?\.pdf$/);
    const [key, bytes] = s3.uploadPrivate.mock.calls[0] as [string, Buffer];
    expect(key).toMatch(new RegExp(`^state/claim-letter-final-pdfs/${claimLetterId}/[0-9a-f]{16}\\.pdf$`));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(7);
    expect(savedFinalPdf()).toMatchObject({ sourceKey: data!.sourceKey, pageCount: 7 });
  });

  it("finds each document through its form's claimEligibility source, GTC by installment, falling back across file keys", async () => {
    await service.getFinalPdf(claimLetterId, user);

    expect(formJsonService.findEnabledClaimEligibilitySources).toHaveBeenCalledWith(String(parent['year']));
    const byCollection = Object.fromEntries(findOneCalls.map((c) => [c.collection, c.filter]));
    expect(byCollection['xvifc_gtc']).toEqual({
      year: parent['year'],
      state: stateOid,
      installment: 1,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    });
    expect(byCollection['xvifc_unspent_state_forms']).not.toHaveProperty('installment');
    expect(s3.getPdfBufferFromS3).toHaveBeenCalledWith('fc/yes.pdf');
  });

  it('lists a document whose form has no enabled claimEligibility as not included', async () => {
    formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue(
      ELIGIBILITY_SOURCES.filter((f) => f.formId !== 35),
    );
    const { data } = await service.getFinalPdf(claimLetterId, user);

    expect(data!.missing).toEqual(['Copy of GTC', 'Other Supporting Documents (ATR)']);
    expect(findOneCalls.map((c) => c.collection)).not.toContain('xvifc_gtc');
  });

  it('shares one merge between concurrent first requests', async () => {
    const [a, b] = await Promise.all([
      service.getFinalPdf(claimLetterId, user),
      service.getFinalPdf(claimLetterId, user),
    ]);

    expect(s3.uploadPrivate).toHaveBeenCalledTimes(1);
    expect(batchModel.updateOne).toHaveBeenCalledTimes(1);
    expect(a.data!.sourceKey).toBe(b.data!.sourceKey);
  });

  it('flags missing required documents, but not a missing optional one', async () => {
    const withAllRequired = await service.getFinalPdf(claimLetterId, user);
    expect(withAllRequired.data!.missingRequired).toEqual([]);

    formDocs['xvifc_gtc'] = null;
    const withoutGtc = await service.getFinalPdf(claimLetterId, user);
    expect(withoutGtc.data!.missing).toEqual(['Copy of GTC', 'Other Supporting Documents (ATR)']);
    expect(withoutGtc.data!.missingRequired).toEqual(['Copy of GTC']);
  });

  it('reuses the cached PDF when no input changed (no download, merge or upload)', async () => {
    await service.getFinalPdf(claimLetterId, user);
    parent['finalClaimPdf'] = savedFinalPdf();
    s3.getPdfBufferFromS3.mockClear();
    s3.uploadPrivate.mockClear();

    await service.getFinalPdf(claimLetterId, user);

    expect(s3.getPdfBufferFromS3).not.toHaveBeenCalled();
    expect(s3.uploadPrivate).not.toHaveBeenCalled();
  });

  it('rebuilds when any document is re-uploaded (new path, new key)', async () => {
    const first = await service.getFinalPdf(claimLetterId, user);
    parent['finalClaimPdf'] = savedFinalPdf();
    formDocs['xvifc_gtc'] = { data: { i2GtcFile: { path: 'gtc/i2-v2.pdf' } } };
    files['gtc/i2-v2.pdf'] = await pdfWithPages(4);

    const second = await service.getFinalPdf(claimLetterId, user);

    expect(second.data!.sourceKey).not.toBe(first.data!.sourceKey);
    expect(second.data!.pageCount).toBe(10);
  });

  it('names a password-protected document in a 422', async () => {
    jest.spyOn(PDFDocument, 'load').mockRejectedValueOnce(new EncryptedPDFError());
    const err = await caught(service.getFinalPdf(claimLetterId, user));

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({
      message:
        'Signed claim letter is password-protected. Upload a readable, unprotected PDF as the signed claim letter.',
      code: FINAL_PDF_SOURCE_UNREADABLE,
    });
    expect(s3.uploadPrivate).not.toHaveBeenCalled();
  });

  it('names a damaged or missing document with the form to re-upload it in', async () => {
    files['gtc/i2.pdf'] = Buffer.from('not a pdf');
    const damaged = await caught(service.getFinalPdf(claimLetterId, user));
    expect((damaged.getResponse() as { message: string }).message).toBe(
      'Copy of GTC is damaged. Upload a readable, unprotected PDF in the Grant Transfer Certificate form.',
    );

    delete files['gtc/i2.pdf'];
    const missing = await caught(service.getFinalPdf(claimLetterId, user));
    expect((missing.getResponse() as { message: string }).message).toMatch(/^Copy of GTC could not be found\./);
  });

  it('merges only the signed letter when no documents are configured', async () => {
    const formJson = { loadFormConfig: jest.fn().mockResolvedValue({ mergeDocuments: [] }) };
    service = new ClaimLetterFinalPdfService(
      formJson as unknown as ClaimLetterFormJsonService,
      formJsonService as unknown as FormJsonService,
      activeBatch as unknown as ClaimLetterActiveBatchService,
      s3 as unknown as S3Service,
      { collection: () => ({ findOne: jest.fn() }) } as never,
      batchModel as never,
      { findById: jest.fn(() => q({ name: 'Sample State' })) } as never,
    );
    const { data } = await service.getFinalPdf(claimLetterId, user);
    expect(data).toMatchObject({ included: ['Signed claim letter'], missing: [], pageCount: 3 });
  });

  it('needs a signed letter, an editable batch and the active batch', async () => {
    parent['signedClaimFile'] = null;
    await expect(service.getFinalPdf(claimLetterId, user)).rejects.toThrow(BadRequestException);

    parent['signedClaimFile'] = { path: 'signed/letter.pdf' };
    parent['currentFormStatus'] = 5;
    await expect(service.getFinalPdf(claimLetterId, user)).rejects.toThrow(ConflictException);

    parent['currentFormStatus'] = 2;
    parent['isAbandoned'] = true;
    await expect(service.getFinalPdf(claimLetterId, user)).rejects.toThrow('This claim letter was abandoned.');

    parent['isAbandoned'] = false;
    activeBatch.assertActive.mockRejectedValue(new ConflictException('Batch 1 is still in progress'));
    await expect(service.getFinalPdf(claimLetterId, user)).rejects.toThrow('Batch 1 is still in progress');
  });

  describe('after submission', () => {
    beforeEach(async () => {
      await service.getFinalPdf(claimLetterId, user);
      Object.assign(parent, { currentFormStatus: 5, submittedAt: new Date(), finalClaimPdf: savedFinalPdf() });
      s3.getPdfBufferFromS3.mockClear();
      s3.uploadPrivate.mockClear();
      findOneCalls = [];
      // Neither the active-batch rule nor a later upload applies to the copy MoHUA received.
      activeBatch.assertActive.mockRejectedValue(new ConflictException('Batch 1 is still in progress'));
      formDocs['xvifc_gtc'] = { data: { i2GtcFile: { path: 'gtc/i2-v2.pdf' } } };
    });

    it('returns the copy it was submitted with, without rebuilding', async () => {
      const stored = parent['finalClaimPdf'] as { sourceKey: string; file: { path: string } };
      const { data } = await service.getFinalPdf(claimLetterId, user);

      expect(data).toMatchObject({ sourceKey: stored.sourceKey, pageCount: 7 });
      expect(findOneCalls).toEqual([]);
      expect(s3.uploadPrivate).not.toHaveBeenCalled();

      files[stored.file.path] = await pdfWithPages(7);
      const file = await service.getFinalPdfFile(claimLetterId, user);
      expect(s3.getPdfBufferFromS3).toHaveBeenCalledWith(stored.file.path);
      expect((await PDFDocument.load(file.buffer)).getPageCount()).toBe(7);
    });

    it('is a 404 when no copy was stored', async () => {
      parent['finalClaimPdf'] = null;
      await expect(service.getFinalPdf(claimLetterId, user)).rejects.toThrow(NotFoundException);
    });
  });

  it('streams freshly merged bytes, or the cached object from S3', async () => {
    const fresh = await service.getFinalPdfFile(claimLetterId, user);
    expect(fresh.fileName).toMatch(/^CF_Sample-State_Claim-letter-1-2(_[\d-]+)?\.pdf$/);
    expect((await PDFDocument.load(fresh.buffer)).getPageCount()).toBe(7);

    parent['finalClaimPdf'] = savedFinalPdf();
    const cachedPath = (parent['finalClaimPdf'] as { file: { path: string } }).file.path;
    files[cachedPath] = fresh.buffer;
    s3.getPdfBufferFromS3.mockClear();
    await service.getFinalPdfFile(claimLetterId, user);
    expect(s3.getPdfBufferFromS3).toHaveBeenCalledTimes(1);
    expect(s3.getPdfBufferFromS3).toHaveBeenCalledWith(cachedPath);
  });

  describe('assertReviewedKey (submit)', () => {
    it('passes when the reviewed key matches the inputs and the cached PDF', async () => {
      const { data } = await service.getFinalPdf(claimLetterId, user);
      parent['finalClaimPdf'] = savedFinalPdf();
      await expect(service.assertReviewedKey(parent as never, data!.sourceKey)).resolves.toBeUndefined();
    });

    it('refuses a missing required document with FINAL_PDF_INCOMPLETE, naming its form', async () => {
      const { data } = await service.getFinalPdf(claimLetterId, user);
      parent['finalClaimPdf'] = savedFinalPdf();
      formDocs['xvifc_gtc'] = null;

      const err = await caught(service.assertReviewedKey(parent as never, data!.sourceKey));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        message:
          'Missing required documents: Copy of GTC (Grant Transfer Certificate form). Upload them before submitting.',
        code: FINAL_PDF_INCOMPLETE,
      });
    });

    it('refuses a stale key with FINAL_PDF_OUTDATED', async () => {
      const { data } = await service.getFinalPdf(claimLetterId, user);
      parent['finalClaimPdf'] = savedFinalPdf();
      formDocs['xvifc_sfc'] = { data: { atrReport: { path: 'sfc/atr.pdf' } } };

      const err = await caught(service.assertReviewedKey(parent as never, data!.sourceKey));
      expect((err.getResponse() as { code: string }).code).toBe(FINAL_PDF_OUTDATED);
    });

    it('refuses when the reviewed PDF was never cached', async () => {
      const { data } = await service.getFinalPdf(claimLetterId, user);
      const err = await caught(service.assertReviewedKey({ ...parent, finalClaimPdf: null } as never, data!.sourceKey));
      expect((err.getResponse() as { code: string }).code).toBe(FINAL_PDF_OUTDATED);
    });
  });
});

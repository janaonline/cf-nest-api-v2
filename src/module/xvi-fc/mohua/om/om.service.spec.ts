import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import { OM_STATUS } from 'src/schemas/xvi-fc/mohua/om.schema';
import { OmService } from './om.service';

/** Mongoose chain: every builder returns the chain, `.exec()` resolves `result`. */
function q<T>(result: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'sort', 'lean', 'session']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(result);
  return chain;
}

const letterId = new Types.ObjectId();
const stateId = new Types.ObjectId();
const yearId = new Types.ObjectId();
const omId = new Types.ObjectId();
const user = { _id: new Types.ObjectId().toString(), role: 'MoHUA', scope: 'MOHUA' } as never;

const letter = () => ({
  _id: letterId,
  state: stateId,
  year: yearId,
  installment: 1,
  batchNumber: 1,
  revision: 2,
  currentFormStatus: 5,
  isAbandoned: false,
  ulbCount: 2,
  financialSummary: { currentSelectedClaim: 60_000_000 },
});

/** A blank PDF with `pages` pages. */
async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

async function pageCount(buffer: Buffer): Promise<number> {
  return (await PDFDocument.load(buffer)).getPageCount();
}

const fullDocument = {
  refNo: 'CL/TR/2026-27/1-1',
  stateName: 'Tripura',
  designYearLabel: '2026-27',
  installment: 1,
  counts: { stateUlbTotal: 21 },
  letter: { compliance: [] },
  annexure: { title: 'Annexure', columns: [], lists: [] },
  rowsByList: { ELIGIBLE: [], INELIGIBLE: [] },
};

describe('OmService', () => {
  let omModel: { findOne: jest.Mock; find: jest.Mock; findOneAndUpdate: jest.Mock; updateOne: jest.Mock; countDocuments: jest.Mock };
  let omLogModel: { create: jest.Mock };
  let omUlbModel: { countDocuments: jest.Mock; insertMany: jest.Mock; updateMany: jest.Mock };
  let batchModel: { findOne: jest.Mock; find: jest.Mock; findById: jest.Mock };
  let batchUlbModel: { find: jest.Mock };
  let stateModel: { findById: jest.Mock; find: jest.Mock };
  let yearModel: { findById: jest.Mock };
  let grantAllocationModel: { findOne: jest.Mock };
  let documentService: { buildFullDocument: jest.Mock };
  let pdfService: { render: jest.Mock };
  let s3Service: { getPdfBufferFromS3: jest.Mock };
  let normalizer: { normalizeInboundFileInfo: jest.Mock };
  let fileTokens: { signFileUrlForSession: jest.Mock };
  let session: { startTransaction: jest.Mock; commitTransaction: jest.Mock; abortTransaction: jest.Mock; endSession: jest.Mock };
  let service: OmService;

  beforeEach(async () => {
    omModel = {
      findOne: jest.fn().mockReturnValue(q({ _id: omId, claimLetter: letterId, status: OM_STATUS.DRAFT, omNumber: 'F-1/2026', omDate: '2026-11-04' })),
      find: jest.fn().mockReturnValue(q([])),
      findOneAndUpdate: jest.fn().mockReturnValue(q({ _id: omId })),
      updateOne: jest.fn().mockReturnValue(q({ matchedCount: 1 })),
      countDocuments: jest.fn().mockResolvedValue(3),
    };
    omLogModel = { create: jest.fn().mockResolvedValue([]) };
    omUlbModel = {
      countDocuments: jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue(2) }),
      insertMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockReturnValue(q({ modifiedCount: 2 })),
    };
    batchModel = {
      findOne: jest.fn().mockReturnValue(q(letter())),
      find: jest.fn().mockReturnValue(q([])),
      // The stored final claim PDF: the 1-page signed letter followed by 2 annexure pages.
      findById: jest.fn().mockReturnValue(
        q({ finalClaimPdf: { file: { path: 'final.pdf' } }, signedClaimFile: { path: 'signed.pdf' } }),
      ),
    };
    batchUlbModel = { find: jest.fn().mockReturnValue(q([])) };
    stateModel = { findById: jest.fn().mockReturnValue(q({ code: 'TR' })), find: jest.fn().mockReturnValue(q([])) };
    yearModel = { findById: jest.fn().mockReturnValue(q({ year: '2026-27' })) };
    grantAllocationModel = { findOne: jest.fn().mockReturnValue(q({ basic: 650_000_000 })) };
    documentService = { buildFullDocument: jest.fn().mockResolvedValue(fullDocument) };
    pdfService = { render: jest.fn().mockResolvedValue(await pdf(2)) };
    const files: Record<string, Buffer> = { 'final.pdf': await pdf(3), 'signed.pdf': await pdf(1) };
    s3Service = { getPdfBufferFromS3: jest.fn((path: string) => Promise.resolve(files[path])) };
    normalizer = { normalizeInboundFileInfo: jest.fn() };
    fileTokens = { signFileUrlForSession: jest.fn().mockReturnValue('https://signed/om.pdf') };
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    service = new OmService(
      omModel as never,
      omLogModel as never,
      omUlbModel as never,
      batchModel as never,
      batchUlbModel as never,
      stateModel as never,
      yearModel as never,
      grantAllocationModel as never,
      documentService as never,
      pdfService as never,
      s3Service as never,
      normalizer as never,
      fileTokens as never,
      { startSession: jest.fn().mockResolvedValue(session) } as never,
    );
  });

  describe('generate', () => {
    it('numbers the OM, freezes its content and stamps every ULB of the letter, in one transaction', async () => {
      const file = await service.generate(String(letterId), user, '1.2.3.4', 'jest');

      const [filter, update] = omModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, { $set: Record<string, unknown> }];
      expect(filter).toEqual({ claimLetter: letterId, status: OM_STATUS.DRAFT });
      expect(update.$set).toMatchObject({
        status: OM_STATUS.GENERATED,
        omNumber: 'F-1/2026',
        sequence: 4,
        refNo: 'OM/TR/2026-27/4',
        ulbCount: 2,
        totalAmount: 60_000_000,
      });
      expect(omUlbModel.updateMany).toHaveBeenCalledWith({ claimLetter: letterId, om: null }, { $set: { om: omId } }, { session });
      expect(omLogModel.create).toHaveBeenCalledWith([expect.objectContaining({ om: omId, action: 'GENERATED' })], { session });
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(file.fileName).toMatch(/\.pdf$/);
    });

    it("returns one PDF: the OM's pages, then the claim letter's annexures without its signed covering letter", async () => {
      const file = await service.generate(String(letterId), user);

      // 2 OM pages + (3 final-PDF pages - 1 signed-letter page).
      expect(await pageCount(file.buffer)).toBe(4);
    });

    it('issues the OM alone for a letter that has no stored final PDF', async () => {
      batchModel.findById.mockReturnValue(q({ finalClaimPdf: null, signedClaimFile: { path: 'signed.pdf' } }));

      const file = await service.generate(String(letterId), user);

      expect(await pageCount(file.buffer)).toBe(2);
    });

    it('refuses (422) when the stored annexures cannot be read', async () => {
      s3Service.getPdfBufferFromS3.mockResolvedValue(Buffer.from('not a pdf'));

      await expect(service.generate(String(letterId), user)).rejects.toThrow(UnprocessableEntityException);
    });

    it('needs the OM No., and only for a letter the SO verified', async () => {
      omModel.findOne.mockReturnValue(q({ _id: omId, status: OM_STATUS.DRAFT, omNumber: '  ' }));
      await expect(service.generate(String(letterId), user)).rejects.toThrow(BadRequestException);

      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.generate(String(letterId), user)).rejects.toThrow(NotFoundException);
      expect(session.startTransaction).not.toHaveBeenCalled();
    });

    it('returns the issued OM again, from its frozen content, without writing', async () => {
      const content = { stateName: 'Tripura', installment: 1, designYearLabel: '2026-27' };
      omModel.findOne.mockReturnValue(q({ _id: omId, status: OM_STATUS.GENERATED, content }));

      await service.generate(String(letterId), user);

      expect(pdfService.render).toHaveBeenCalledWith(content);
      expect(session.startTransaction).not.toHaveBeenCalled();
    });

    it('aborts when some of the letter\'s ULBs are already in another OM', async () => {
      omUlbModel.updateMany.mockReturnValue(q({ modifiedCount: 1 }));

      await expect(service.generate(String(letterId), user)).rejects.toThrow(ConflictException);
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('saveDraft', () => {
    it('refuses to edit an OM that is no longer a draft', async () => {
      omModel.updateOne.mockReturnValue({ exec: jest.fn().mockRejectedValue({ code: 11000 }) });

      await expect(service.saveDraft(String(letterId), { omNumber: 'F-2' }, user)).rejects.toThrow(ConflictException);
    });
  });

  describe('uploadSignedFile', () => {
    it('saves the signed PDF and marks the OM signed', async () => {
      const issued = { _id: omId, claimLetter: letterId, state: stateId, status: OM_STATUS.GENERATED, content: {}, signedFile: null };
      omModel.findOne.mockReturnValue(q(issued));
      normalizer.normalizeInboundFileInfo.mockReturnValue({ file: { path: 'oms/signed.pdf' }, errors: [] });

      await service.uploadSignedFile(String(omId), { path: 'oms/signed.pdf' } as never, user);

      expect(normalizer.normalizeInboundFileInfo).toHaveBeenCalledWith(
        { path: 'oms/signed.pdf' },
        null,
        expect.objectContaining({ allowedExtensions: ['pdf'], maxSizeKb: 5 * 1024 }),
      );
      expect((omModel.updateOne.mock.calls[0] as [unknown, { $set: Record<string, unknown> }])[1].$set).toMatchObject({
        status: OM_STATUS.SIGNED_UPLOADED,
        signedFile: { path: 'oms/signed.pdf' },
      });
    });

    it('rejects a file that is not a valid PDF', async () => {
      omModel.findOne.mockReturnValue(q({ _id: omId, status: OM_STATUS.GENERATED, content: {}, signedFile: null }));
      normalizer.normalizeInboundFileInfo.mockReturnValue({ file: null, errors: [{ message: 'PDF only' }] });

      await expect(service.uploadSignedFile(String(omId), {} as never, user)).rejects.toThrow(BadRequestException);
    });
  });
});

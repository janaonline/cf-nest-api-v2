import { Test, TestingModule } from '@nestjs/testing';
import { FileInfoNormalizerService } from './file-info-normalizer.service';
import { FileUrlNormalizerService } from './file-url-normalizer.service';
import type { FileInfo } from 'src/schemas/common/file.schema';

describe('FileInfoNormalizerService', () => {
  let service: FileInfoNormalizerService;
  let mockFileUrlNormalizer: { toRawStoragePath: jest.Mock };

  const validInput = {
    originalName: 'report.xlsx',
    path: 'state/2026-27/report.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeKb: 34.5,
    createdAt: '2026-07-11T14:10:00.245Z',
    updatedAt: '2026-07-11T14:12:00.000Z', // client-echoed; must never be trusted
  };

  function existingFile(overrides: Partial<FileInfo> = {}): FileInfo {
    return {
      originalName: 'old-report.xlsx',
      name: '',
      path: 'state/2026-27/report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      sizeKb: 30,
      pageCount: null,
      sha256: 'abc123',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    mockFileUrlNormalizer = { toRawStoragePath: jest.fn((v: string) => v) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FileInfoNormalizerService, { provide: FileUrlNormalizerService, useValue: mockFileUrlNormalizer }],
    }).compile();

    service = module.get(FileInfoNormalizerService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── deriveFileExtension ───────────────────────────────────────────────────

  describe('deriveFileExtension', () => {
    it('lowercases the extension', () => {
      expect(service.deriveFileExtension('Report.PDF')).toBe('pdf');
    });

    it('returns empty string when there is no extension', () => {
      expect(service.deriveFileExtension('report')).toBe('');
    });

    it('returns empty string for null/undefined', () => {
      expect(service.deriveFileExtension(null)).toBe('');
      expect(service.deriveFileExtension(undefined)).toBe('');
    });
  });

  // ─── normalizeInboundFileInfo: new file ────────────────────────────────────

  describe('normalizeInboundFileInfo — new file (no existing)', () => {
    it('does not set createdAt/updatedAt — Mongoose assigns both once the object reaches $set/.create()', () => {
      const { file, errors } = service.normalizeInboundFileInfo(validInput, null);
      expect(errors).toHaveLength(0);
      expect(file!.createdAt).toBeUndefined();
      expect(file!.updatedAt).toBeUndefined();
    });

    it('never persists the client-supplied updatedAt', () => {
      const { file } = service.normalizeInboundFileInfo(validInput, null);
      expect(file!.updatedAt).not.toBe(validInput.updatedAt);
    });

    it('derives extension from originalName, lowercased', () => {
      const { file } = service.normalizeInboundFileInfo({ ...validInput, originalName: 'Report.XLSX' }, null);
      expect(file!.extension).toBe('xlsx');
    });

    it('normalizes the incoming path via FileUrlNormalizerService', () => {
      mockFileUrlNormalizer.toRawStoragePath.mockReturnValueOnce('raw/report.xlsx');
      const { file } = service.normalizeInboundFileInfo(validInput, null);
      expect(mockFileUrlNormalizer.toRawStoragePath).toHaveBeenCalledWith(validInput.path);
      expect(file!.path).toBe('raw/report.xlsx');
    });

    it('sets sha256 to empty string (no trusted hash for a new file)', () => {
      const { file } = service.normalizeInboundFileInfo(validInput, null);
      expect(file!.sha256).toBe('');
    });

    it('returns null with no errors when input is null/undefined', () => {
      expect(service.normalizeInboundFileInfo(null, null)).toEqual({ file: null, errors: [] });
      expect(service.normalizeInboundFileInfo(undefined, null)).toEqual({ file: null, errors: [] });
    });
  });

  // ─── normalizeInboundFileInfo: unchanged file ──────────────────────────────

  describe('normalizeInboundFileInfo — unchanged file (same normalized path)', () => {
    it('returns file: undefined — caller must omit the field from $set so Mongoose leaves the stored subdocument (and its timestamps) untouched', () => {
      const existing = existingFile();
      const { file, errors } = service.normalizeInboundFileInfo(validInput, existing);
      expect(errors).toHaveLength(0);
      expect(file).toBeUndefined();
    });

    it('discards client-sent originalName/mimeType/sizeKb — the caller falls back to the stored existing object, never a merged one', () => {
      const existing = existingFile({ originalName: 'old-report.xlsx', sizeKb: 30 });
      const { file } = service.normalizeInboundFileInfo(
        { ...validInput, originalName: 'renamed.xlsx', sizeKb: 999 },
        existing,
      );
      expect(file).toBeUndefined();
      expect(existing.originalName).toBe('old-report.xlsx');
      expect(existing.sizeKb).toBe(30);
    });

    it('treats a signed-URL echo of the same underlying path as unchanged', () => {
      mockFileUrlNormalizer.toRawStoragePath.mockReturnValueOnce('state/2026-27/report.xlsx');
      const existing = existingFile({ path: 'state/2026-27/report.xlsx' });
      const signedInput = { ...validInput, path: 'https://app.example.com/file/download?signature=xyz' };
      const { file, errors } = service.normalizeInboundFileInfo(signedInput, existing);
      expect(errors).toHaveLength(0);
      expect(file).toBeUndefined();
    });
  });

  // ─── normalizeInboundFileInfo: replacement file ────────────────────────────

  describe('normalizeInboundFileInfo — replacement file (different normalized path)', () => {
    it('builds a fresh FileInfo without stamping timestamps — Mongoose assigns both once persisted', () => {
      const existing = existingFile({ path: 'state/2026-27/old-report.xlsx' });
      const { file } = service.normalizeInboundFileInfo(validInput, existing);
      expect(file!.path).toBe(validInput.path);
      expect(file!.createdAt).toBeUndefined();
      expect(file!.updatedAt).toBeUndefined();
    });

    it('does not carry over the previous file sha256', () => {
      const existing = existingFile({ path: 'state/2026-27/old-report.xlsx', sha256: 'old-hash' });
      const { file } = service.normalizeInboundFileInfo(validInput, existing);
      expect(file!.sha256).toBe('');
    });
  });

  // ─── Validation failures ────────────────────────────────────────────────────

  describe('normalizeInboundFileInfo — validation', () => {
    it('rejects a missing originalName', () => {
      const { file, errors } = service.normalizeInboundFileInfo({ ...validInput, originalName: '' }, null);
      expect(file).toBeNull();
      expect(errors.some((e) => e.code === 'required')).toBe(true);
    });

    it('rejects a non-finite sizeKb', () => {
      const { errors } = service.normalizeInboundFileInfo({ ...validInput, sizeKb: NaN }, null);
      expect(errors.some((e) => e.code === 'invalidSize')).toBe(true);
    });

    it('rejects a negative sizeKb', () => {
      const { errors } = service.normalizeInboundFileInfo({ ...validInput, sizeKb: -1 }, null);
      expect(errors.some((e) => e.code === 'invalidSize')).toBe(true);
    });

    it('does not validate createdAt at all — it is Mongoose-managed, not client-supplied', () => {
      const { file, errors } = service.normalizeInboundFileInfo({ ...validInput, createdAt: 'not-a-date' }, null);
      expect(errors).toHaveLength(0);
      expect(file).not.toBeNull();
    });

    it('rejects a negative pageCount', () => {
      const { errors } = service.normalizeInboundFileInfo({ ...validInput, pageCount: -1 }, null);
      expect(errors.some((e) => e.code === 'invalidPageCount')).toBe(true);
    });

    it('applies the fieldKey option to emitted errors', () => {
      const { errors } = service.normalizeInboundFileInfo({ ...validInput, originalName: '' }, null, {
        fieldKey: 'excelFile',
      });
      expect(errors[0].field).toBe('excelFile');
    });

    it('rejects a MIME/extension conflict when allowedExtensions+allowedMimeTypes are set', () => {
      const { errors } = service.normalizeInboundFileInfo(
        { ...validInput, originalName: 'report.pdf', mimeType: 'application/pdf' },
        null,
        {
          allowedExtensions: ['xlsx', 'xls'],
          allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        },
      );
      expect(errors.some((e) => e.code === 'invalidFileType')).toBe(true);
    });

    it('accepts a file matching both allowedExtensions and allowedMimeTypes', () => {
      const { file, errors } = service.normalizeInboundFileInfo(validInput, null, {
        allowedExtensions: ['xlsx', 'xls'],
        allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      });
      expect(errors).toHaveLength(0);
      expect(file).not.toBeNull();
    });

    it('rejects a file exceeding maxSizeKb', () => {
      const { errors } = service.normalizeInboundFileInfo({ ...validInput, sizeKb: 20 * 1024 + 1 }, null, {
        maxSizeKb: 20 * 1024,
      });
      expect(errors.some((e) => e.code === 'maxFileSize')).toBe(true);
    });
  });

  // ─── hydrateFileInfoForResponse ─────────────────────────────────────────────

  describe('hydrateFileInfoForResponse', () => {
    it('returns null for a null/undefined file', () => {
      expect(service.hydrateFileInfoForResponse(null, (p) => p)).toBeNull();
      expect(service.hydrateFileInfoForResponse(undefined, (p) => p)).toBeNull();
    });

    it('signs the path via the provided signPath callback', () => {
      const file = existingFile();
      const signPath = jest.fn((p: string) => `signed::${p}`);
      const result = service.hydrateFileInfoForResponse(file, signPath);
      expect(signPath).toHaveBeenCalledWith(file.path);
      expect(result!.path).toBe(`signed::${file.path}`);
    });

    it('returns ISO strings for createdAt and updatedAt', () => {
      const file = existingFile();
      const result = service.hydrateFileInfoForResponse(file, (p) => p);
      expect(result!.createdAt).toBe(file.createdAt.toISOString());
      expect(result!.updatedAt).toBe(file.updatedAt.toISOString());
    });

    it('never mutates the database (pure transform — no model/DB dependency exists on this service)', () => {
      // FileInfoNormalizerService has no Mongoose model injected at all, so hydration
      // structurally cannot perform a DB write. This test documents that invariant.
      expect((service as unknown as { formModel?: unknown }).formModel).toBeUndefined();
    });

    it('returns null for a legacy-shaped object with no path', () => {
      const legacyShaped = { fileName: 'x.xlsx', fileUrl: 'y', fileSize: 100 } as unknown as FileInfo;
      expect(service.hydrateFileInfoForResponse(legacyShaped, (p) => p)).toBeNull();
    });
  });

  // ─── isSameStoredFile ────────────────────────────────────────────────────────

  describe('isSameStoredFile', () => {
    it('returns true when the normalized path matches the existing stored path', () => {
      const existing = existingFile({ path: 'a/b.xlsx' });
      expect(service.isSameStoredFile('a/b.xlsx', existing)).toBe(true);
    });

    it('returns false when paths differ', () => {
      const existing = existingFile({ path: 'a/b.xlsx' });
      expect(service.isSameStoredFile('a/c.xlsx', existing)).toBe(false);
    });

    it('returns false when there is no existing file', () => {
      expect(service.isSameStoredFile('a/b.xlsx', null)).toBe(false);
    });
  });
});

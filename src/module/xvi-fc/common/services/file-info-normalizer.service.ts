import { Injectable } from '@nestjs/common';
import { FileInfo } from 'src/schemas/common/file.schema';
import { XviFcValidationError } from '../response/xvi-fc-api-response';
import { FileUrlNormalizerService } from './file-url-normalizer.service';

export interface FileInfoValidationOptions {
  /** Lowercase extensions without a leading dot, e.g. ['xlsx', 'xls']. */
  allowedExtensions?: string[];
  allowedMimeTypes?: string[];
  maxSizeKb?: number;
  /** Field key used on emitted validation errors. Defaults to 'file'. */
  fieldKey?: string;
}

export interface NormalizeInboundFileResult {
  /**
   * `undefined` means "no persistence-layer change" — either the field was absent
   * from the request, or it points at the same stored file as `existing` (in which
   * case the caller must omit the field from `$set` entirely, not re-include the
   * existing object, so Mongoose's automatic FileInfo timestamps aren't disturbed).
   */
  file: FileInfo | null | undefined;
  errors: XviFcValidationError[];
}

export interface HydratedFileInfoResponse {
  originalName: string;
  path: string;
  mimeType: string;
  sizeKb: number;
  pageCount: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Normalizes inbound canonical file objects into the persisted FileInfo shape, and
 * hydrates stored FileInfo values for API responses. Shared across all XVI-FC
 * State-form modules (SFC Status, Devolution Formula, Elected Urban Local Bodies).
 *
 * Write paths always reconstruct an explicit allow-listed FileInfo object here —
 * never a spread of the raw client input — so a client-supplied `updatedAt` (or any
 * other stray key) never reaches persistence.
 */
@Injectable()
export class FileInfoNormalizerService {
  constructor(private readonly fileUrlNormalizer: FileUrlNormalizerService) {}

  /** originalName.split('.').pop()?.toLowerCase(), or '' when there's no extension. */
  deriveFileExtension(originalName: string | null | undefined): string {
    if (!originalName || !originalName.includes('.')) return '';
    const ext = originalName.split('.').pop();
    return ext ? ext.toLowerCase() : '';
  }

  /** Compares a normalized raw path against the existing stored file's raw path. */
  isSameStoredFile(normalizedIncomingPath: string, existing: FileInfo | null | undefined): boolean {
    if (!existing?.path || !normalizedIncomingPath) return false;
    return existing.path === normalizedIncomingPath;
  }

  /**
   * Builds a canonical FileInfo from validated inbound request data.
   *
   * - Silently discards `input.createdAt`/`input.updatedAt` (never read here) —
   *   both are Mongoose-managed timestamps on the FileInfo schema.
   * - Normalizes a signed `path` back to a raw S3-relative path before comparing/storing.
   * - When the normalized path matches `existing`, returns `file: undefined` — the
   *   caller must omit the field from `$set` so the stored subdocument (and its
   *   Mongoose-managed timestamps) is left untouched. The UI cannot alter metadata
   *   while reusing the same stored file.
   * - Otherwise builds a fresh FileInfo (timestamps assigned by Mongoose once the
   *   object reaches `$set`/`.create()`).
   */
  normalizeInboundFileInfo(
    input: Record<string, unknown> | null | undefined,
    existing: FileInfo | null | undefined,
    opts: FileInfoValidationOptions = {},
  ): NormalizeInboundFileResult {
    if (input === null || input === undefined) {
      return { file: null, errors: [] };
    }

    const fieldKey = opts.fieldKey ?? 'file';
    const errors: XviFcValidationError[] = [];

    const originalName = typeof input.originalName === 'string' ? input.originalName.trim() : '';
    const incomingPathRaw = typeof input.path === 'string' ? input.path.trim() : '';
    const mimeType = typeof input.mimeType === 'string' ? input.mimeType.trim() : '';
    const sizeKb = typeof input.sizeKb === 'number' ? input.sizeKb : NaN;
    const pageCountRaw = input.pageCount;

    if (!originalName) {
      errors.push({ field: fieldKey, message: 'originalName is required.', code: 'required' });
    }
    if (!incomingPathRaw) {
      errors.push({ field: fieldKey, message: 'path is required.', code: 'required' });
    }
    if (!mimeType) {
      errors.push({ field: fieldKey, message: 'mimeType is required.', code: 'required' });
    }
    if (!Number.isFinite(sizeKb) || sizeKb < 0) {
      errors.push({ field: fieldKey, message: 'sizeKb must be a non-negative number.', code: 'invalidSize' });
    }

    let pageCount: number | null = null;
    if (pageCountRaw !== null && pageCountRaw !== undefined) {
      if (typeof pageCountRaw !== 'number' || !Number.isInteger(pageCountRaw) || pageCountRaw < 0) {
        errors.push({
          field: fieldKey,
          message: 'pageCount must be a non-negative integer or null.',
          code: 'invalidPageCount',
        });
      } else {
        pageCount = pageCountRaw;
      }
    }

    if (errors.length > 0) {
      return { file: null, errors };
    }

    const normalizedPath = this.fileUrlNormalizer.toRawStoragePath(incomingPathRaw);
    const extension = this.deriveFileExtension(originalName);
    const pathExtension = this.deriveFileExtension(normalizedPath);

    if (opts.allowedExtensions && opts.allowedExtensions.length > 0) {
      const allowedExt = opts.allowedExtensions.map((e) => e.replace(/^\./, '').toLowerCase());
      const extOk = allowedExt.includes(extension) && (pathExtension === '' || allowedExt.includes(pathExtension));
      const mimeOk =
        !opts.allowedMimeTypes || opts.allowedMimeTypes.length === 0
          ? true
          : opts.allowedMimeTypes.map((m) => m.toLowerCase()).includes(mimeType.toLowerCase());

      if (!extOk || !mimeOk) {
        errors.push({
          field: fieldKey,
          message: `Only ${allowedExt.join(', ')} files are supported.`,
          code: 'invalidFileType',
        });
      }
    }

    if (opts.maxSizeKb !== undefined && sizeKb > opts.maxSizeKb) {
      const maxMb = Math.round((opts.maxSizeKb / 1024) * 100) / 100;
      errors.push({ field: fieldKey, message: `File size must not exceed ${maxMb}MB.`, code: 'maxFileSize' });
    }

    if (errors.length > 0) {
      return { file: null, errors };
    }

    if (this.isSameStoredFile(normalizedPath, existing)) {
      return { file: undefined, errors: [] };
    }

    // New or replacement file (unchanged-file case already returned above) — no trusted
    // hash exists for this content, so sha256 is never carried over from a different file.
    // createdAt/updatedAt are intentionally omitted: Mongoose assigns both automatically
    // once this object reaches `$set`/`.create()` (see FileInfoSchema's `timestamps` option).
    const file: FileInfo = {
      originalName,
      name: '',
      path: normalizedPath,
      mimeType,
      extension,
      sizeKb,
      pageCount,
      sha256: '',
    };

    return { file, errors: [] };
  }

  /**
   * Pure read/transform for GET/dump responses. Never mutates the DB. `signPath` lets
   * each module keep its own existing signing implementation/expiry/disposition.
   */
  hydrateFileInfoForResponse(
    file: FileInfo | null | undefined,
    signPath: (rawPath: string) => string,
  ): HydratedFileInfoResponse | null {
    if (!file?.path) return null;

    return {
      originalName: file.originalName ?? '',
      path: signPath(file.path),
      mimeType: file.mimeType,
      sizeKb: file.sizeKb,
      pageCount: file.pageCount ?? null,
      createdAt: file.createdAt instanceof Date ? file.createdAt.toISOString() : String(file.createdAt ?? ''),
      updatedAt: file.updatedAt instanceof Date ? file.updatedAt.toISOString() : String(file.updatedAt ?? ''),
    };
  }
}

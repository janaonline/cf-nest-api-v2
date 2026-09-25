import type { FieldConfig } from '../types/field-config.type';
import type { FileInfoValidationOptions } from '../services/file-info-normalizer.service';

/**
 * Fixed technical fact, not a business config value — DB form-json only ever declares
 * allowed file *extensions* (`allowedFileTypes`), never MIME types. This table derives the
 * MIME types implied by an extension so a DB-only change (adding/removing an extension the
 * business already supports here) never requires a code change; a genuinely new extension
 * still needs one entry added once, which is unavoidable — that's new technical information,
 * not a duplicated business number.
 */
export const EXTENSION_MIME_MAP: Record<string, string[]> = {
  pdf: ['application/pdf'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

/**
 * Derives `FileInfoNormalizerService.normalizeInboundFileInfo`'s validation options from a
 * DB-loaded field's `maxFileSize`/`allowedFileTypes` — the single source of truth for these
 * limits. Replaces hardcoded `*_MAX_FILE_SIZE_MB`/`*_ALLOWED_MIME_TYPES` constants that would
 * otherwise drift from the DB document whenever it's updated independently of the code.
 */
export function deriveFileValidationOptions(field: FieldConfig, fieldKey: string): FileInfoValidationOptions {
  const allowedExtensions = (field.allowedFileTypes ?? []).map((ext) => ext.replace(/^\./, '').toLowerCase());
  const allowedMimeTypes = allowedExtensions.flatMap((ext) => EXTENSION_MIME_MAP[ext] ?? []);

  return {
    allowedExtensions,
    allowedMimeTypes,
    maxSizeKb: field.maxFileSize !== undefined ? field.maxFileSize * 1024 : undefined,
    fieldKey,
  };
}

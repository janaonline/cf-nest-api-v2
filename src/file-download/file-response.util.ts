import * as mimeTypes from 'mime-types';

export type FileDisposition = 'inline' | 'attachment';

/** MIME types that browsers can render inline without prompting a download. */
const INLINE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
]);

/** Type guard — narrows `unknown` to a non-null object so properties can be accessed safely. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Extracts `err.message` from an unknown thrown value, falling back to `'Unknown error'`. */
export function getErrorMessage(err: unknown): string {
  if (!isRecord(err)) return 'Unknown error';
  return typeof err.message === 'string' ? err.message : 'Unknown error';
}

/**
 * Extracts the `type` field from a thrown token error object.
 * Returns `undefined` if the value is not a record or has no string `type`.
 */
export function getTokenErrorType(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  return typeof err.type === 'string' ? err.type : undefined;
}

/**
 * Returns `true` when the AWS error indicates the object does not exist.
 * Checks both the SDK error name (`NoSuchKey`) and the HTTP status code in `$metadata`.
 */
export function isS3NotFoundError(err: unknown): boolean {
  if (!isRecord(err)) return false;
  if (typeof err.name === 'string' && err.name === 'NoSuchKey') return true;
  const meta = err.$metadata;
  if (!isRecord(meta)) return false;
  return meta.httpStatusCode === 404;
}

/** Strips filesystem-unsafe characters from a filename to prevent path traversal or header injection. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

/** Resolves the MIME type for a filename, defaulting to `application/octet-stream` for unknown extensions. */
export function getContentType(fileName: string): string {
  const result: string | false = mimeTypes.lookup(fileName);
  return typeof result === 'string' ? result : 'application/octet-stream';
}

/**
 * Picks `inline` or `attachment` for the Content-Disposition header.
 *
 * - Explicit `"inline"` / `"attachment"` in `requested` always wins.
 * - Otherwise defaults to `inline` for browser-renderable types (PDF, images, plain text)
 *   and `attachment` for everything else.
 */
export function resolveDisposition(contentType: string, requested?: unknown): FileDisposition {
  if (requested === 'inline' || requested === 'attachment') {
    return requested;
  }
  return INLINE_CONTENT_TYPES.has(contentType) ? 'inline' : 'attachment';
}

/**
 * Builds a `Content-Disposition` header value with both legacy `filename=` and
 * RFC 5987 `filename*=UTF-8''` fields for broad browser compatibility.
 */
export function buildContentDisposition(contentType: string, fileName: string, requested?: unknown): string {
  const disposition = resolveDisposition(contentType, requested);
  const safeFileName = fileName.replace(/"/g, "'");
  const encodedFileName = encodeURIComponent(fileName);
  return `${disposition}; filename="${safeFileName}"; filename*=UTF-8''${encodedFileName}`;
}

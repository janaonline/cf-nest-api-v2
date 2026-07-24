import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileTokenService } from 'src/core/file-token/file-token.service';

@Injectable()
export class FileUrlNormalizerService {
  constructor(
    private readonly config: ConfigService,
    private readonly fileTokenService: FileTokenService,
  ) {}

  /**
   * Converts a signed download URL back to the raw S3-relative storage path.
   * Raw S3-relative paths are returned unchanged.
   * Throws BadRequestException when the embedded token has expired or is invalid.
   *
   * Handles BASE_URL values with or without a trailing slash.
   *
   * @param fileUrl Raw S3-relative path or signed download URL.
   * @returns Raw S3-relative storage path safe for DB persistence.
   */
  toRawStoragePath(fileUrl: string): string {
    if (!fileUrl) return fileUrl;
    const baseUrl = this.config.get<string>('BASE_URL', '');
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl ? `${baseUrl}/` : '';
    const signedPrefix = `${normalizedBase}file/download?signature=`;
    if (!fileUrl.startsWith(signedPrefix)) return fileUrl;
    const token = fileUrl.slice(signedPrefix.length);
    let decoded: { path: string };
    try {
      decoded = this.fileTokenService.parseToken(token);
    } catch {
      throw new BadRequestException('The file URL has expired. Please reload the page and try again.');
    }
    const storageUrl = this.config.get<string>('AWS_STORAGE_URL', '');
    return storageUrl && decoded.path.startsWith(storageUrl) ? decoded.path.slice(storageUrl.length) : decoded.path;
  }
}

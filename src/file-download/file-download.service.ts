import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as path from 'node:path';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';
import type { Readable } from 'stream';
import {
  buildContentDisposition,
  getContentType,
  getErrorMessage,
  getTokenErrorType,
  isS3NotFoundError,
  sanitizeFilename,
} from './file-response.util';

/** HTTP headers to set on the download response. */
export interface DownloadHeaders {
  contentType: string;
  contentDisposition: string;
}

/** Everything the controller needs to stream a file to the client. */
export interface PreparedDownload {
  /** S3 object key — used for logging in the controller. */
  key: string;
  stream: Readable;
  headers: DownloadHeaders;
}

@Injectable()
export class FileDownloadService {
  private readonly logger = new Logger(FileDownloadService.name);

  constructor(
    private readonly fileTokenService: FileTokenService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Validates the token, resolves the S3 key, derives response headers,
   * and opens the S3 read stream. Throws an `HttpException` on any failure
   * so the controller stays free of business logic.
   */
  async prepareDownload(signature: string): Promise<PreparedDownload> {
    if (!signature) {
      throw new HttpException('signature is required', HttpStatus.BAD_REQUEST);
    }

    let payload: ReturnType<FileTokenService['parseToken']>;
    try {
      payload = this.fileTokenService.parseToken(signature);
    } catch (err: unknown) {
      const tokenErrorType = getTokenErrorType(err);
      const status = tokenErrorType === 'expired' ? HttpStatus.GONE : HttpStatus.BAD_REQUEST;
      throw new HttpException(tokenErrorType ?? 'invalid_token', status);
    }

    const key = this.s3Service.getKeyFromS3Url(payload.path);
    if (!key) {
      throw new HttpException('Invalid token payload', HttpStatus.BAD_REQUEST);
    }

    const filename = sanitizeFilename(path.posix.basename(key)) || 'download';
    const contentType = getContentType(filename);
    const contentDisposition = buildContentDisposition(contentType, filename, payload.disposition);

    let stream: Readable;
    try {
      stream = await this.s3Service.getObjectStream(key);
    } catch (err: unknown) {
      if (isS3NotFoundError(err)) {
        throw new HttpException('File not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`S3 stream init failed for key "${key}": ${getErrorMessage(err)}`);
      throw new HttpException('Failed to initiate file download', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return { key, stream, headers: { contentType, contentDisposition } };
  }
}

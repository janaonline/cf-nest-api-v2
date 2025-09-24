// src/zip/zip.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as archiver from 'archiver';

@Injectable()
export class ZipService {
  private readonly logger = new Logger(ZipService.name);

  constructor(private readonly s3: S3Client) {}

  /**
   * Create a ZIP stream from S3 keys (in the same bucket) and pipe into `res`.
   * @param params.bucket - S3 bucket
   * @param params.keys - array of S3 object keys
   * @param params.res - Express Response (writable stream)
   * @param params.zipName - download filename (default 'files.zip')
   */
  async streamZipFromS3(params: { bucket: string; keys: string[]; res: import('express').Response; zipName?: string }) {
    const { bucket, keys, res, zipName = 'files.zip' } = params;

    // HTTP headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    // Optional: to avoid buffering/caching at proxies
    res.setHeader('Cache-Control', 'no-store');

    // Create archiver ZIP stream
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Forward archiver output to response
    archive.on('warning', (err) => {
      // Non-fatal archiver warnings (e.g., missing file)
      this.logger.warn(err.message);
    });

    archive.on('error', (err) => {
      // Fatal archiver error
      this.logger.error(err.message);
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });

    archive.pipe(res);

    // Append each S3 object as a stream entry
    for (const key of keys) {
      // You can map key -> a nicer filename here:
      const filename = key.split('/').pop() || key;

      // Fetch S3 object stream
      const obj = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

      const body = obj.Body as NodeJS.ReadableStream | undefined;

      if (!body) {
        this.logger.warn(`Empty body for key: ${key} — skipping`);
        continue;
      }

      // Append stream into the archive under `filename`
      archive.append(body, { name: filename });
    }

    // Finalize the archive (signals end of entries)
    await archive.finalize();
  }
}

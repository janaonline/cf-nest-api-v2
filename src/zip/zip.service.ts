// zip-build.service.ts
import { Injectable, Logger } from '@nestjs/common';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import * as path from 'path';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Service } from '../s3/s3.service';
import { FileItem, ULBData, ZipJobResult } from './zip.types';

@Injectable()
export class ZipBuildService {
  private readonly logger = new Logger(ZipBuildService.name);

  constructor(private readonly s3svc: S3Service) {}

  /**
   * Streams all files into a ZIP and uploads to S3 via multipart streaming.
   * No large buffers on the app server.
   */
  async buildZipToS3(params: { ulbData: ULBData[]; outputKey: string }): Promise<ZipJobResult> {
    try {
      const bucket = this.s3svc.bucket;
      const { ulbData, outputKey } = params;

      const archive = archiver('zip', {
        zlib: { level: 0 },
        forceZip64: true, // important for big zips / many entries
      });

      let totalFiles = 0;
      let skippedFiles = 0;

      // Wire multipart upload
      const bodyStream = new PassThrough();
      const multipart = new Upload({
        client: this.s3svc.client,
        params: {
          Bucket: bucket,
          Key: outputKey,
          Body: bodyStream,
          ContentType: 'application/zip',
        },
        queueSize: 4, // parts in parallel
        partSize: 10 * 1024 * 1024, // 10MB parts
        leavePartsOnError: false,
      });
      // console.log('----step 1--------');

      // ✅ Start the upload NOW so it drains the stream as we write
      const uploadPromise = multipart.done();
      // Propagate archiver output → S3 multipart
      archive.pipe(bodyStream);

      // Archiver logging
      archive.on('warning', (err) => {
        this.logger.warn(`archiver warning: ${err.message}`);
      });
      archive.on('error', (err) => {
        throw err;
      });
      // console.log('----step 2--------');
      // Append files sequentially (safe for memory)
      for (const ulb of ulbData) {
        for (const f of ulb.files) {
          const name = f.name?.trim() || path.basename(f.url) || `file-${++totalFiles}.bin`;
          f.url = this.cleanUrl(f.url);
          try {
            // (Optional) HEAD to validate existence quickly
            await this.s3svc.headObject(f.url);

            const obj = await this.s3svc.getObjectStream(f.url);
            archive.append(obj as Readable, { name });
            totalFiles++;
          } catch (e) {
            skippedFiles++;
            this.logger.warn(`Skipping ${f.url}: ${e}`);
          }
          // console.log('file---', totalFiles);
          this.logger.log(`file--- ${totalFiles}`);
        }
      }

      archive.on('finish', () => this.logger.log('archive finish'));
      archive.on('end', () => this.logger.log('archive end'));
      archive.on('close', () => this.logger.log('archive close'));

      // console.log('----step 3--------');
      await archive.finalize(); // flush zip central directory
      // console.log('----step 4--------');
      await uploadPromise; // ✅ wait for S3 multipart to complete
      // await multipart.done(); // complete multipart upload
      // console.log('----step 5--------');
      return { bucket, zipKey: outputKey, totalFiles, skippedFiles };
    } catch (error) {
      this.logger.error('Error building zip to S3', error);
      throw error;
    }
  }

  cleanUrl(filePath: string): string {
    // Remove the first slash if it exists
    const cleanedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return decodeURIComponent(cleanedPath);
  }
}

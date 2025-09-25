import { Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import * as path from 'path';

export interface FileItem {
  name: string;
  url: string;
} // url = S3 key
export interface ULBItem {
  ulbName?: string;
  files: FileItem[];
}
export interface ZipBuildRequest {
  data: ULBItem[];
  zipKey?: string;
}
export interface ZipBuildResult {
  zipKey: string;
  url: string;
  totalFiles: number;
  skippedFiles: number;
  sizeBytes?: number;
}

@Injectable()
export class FilesService {
  // private readonly bucket = process.env.AWS_BUCKET_NAME!;
  private readonly bucket = 'jana-cityfinance-stg';
  // private readonly bucket = 'cityfinance-resources';
  constructor(private readonly s3: S3Client) {}

  async buildZipAndGetUrl(files: string[]): Promise<ZipBuildResult> {
    // const files = req.data.flatMap((x) => x.files || []);
    if (!files.length) throw new Error('No files in request');

    const zipKey = `bundles/${Date.now()}-${Math.random().toString(36).slice(2)}.zip`;

    // short-circuit reuse if already built
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: zipKey }));
      const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: zipKey }), {
        expiresIn: 3600,
      });
      return { zipKey, url, totalFiles: files.length, skippedFiles: 0 };
    } catch {}

    const pass = new PassThrough();
    const uploader = new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: zipKey, Body: pass, ContentType: 'application/zip' },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });

    const archive = archiver('zip', { zlib: { level: 0 } }); // PDFs/images => 0 is fastest
    archive.on('error', (e) => pass.destroy(e));
    archive.pipe(pass);

    const used = new Map<string, number>();
    const unique = (base: string) => {
      const ext = path.extname(base);
      const name = path.basename(base, ext);
      const n = used.get(base) || 0;
      used.set(base, n + 1);
      return n ? `${name} (${n + 1})${ext}` : base;
    };

    let skipped = 0;
    let i = 0;
    for (const f of files) {
      const key = f;
      const ext = path.extname(key) || '';
      const baseRaw = (f.trim() || path.basename(key)).replace(/[\\/]/g, '_');
      const base = baseRaw.endsWith(ext) ? baseRaw : baseRaw + ext;
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      } catch (e) {
        console.log('HeadObjectCommand error', e);
        skipped++;
        continue;
      }
      console.log('key---1-');
      try {
        const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        const body = obj.Body as NodeJS.ReadableStream;
        const nameInZip = unique(base);
        await new Promise<void>((resolve) => {
          body.once('error', () => {
            skipped++;
            resolve();
          });
          archive.append(body, { name: nameInZip });
          body.once('end', () => resolve());
        });
      } catch (e) {
        console.log('GetObjectCommand error', e);
        skipped++;
      }
      console.log('key---2-', i++);
    }
    console.log('key---3-');
    await archive.finalize();
    await uploader.done();
    console.log('key---4-');
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: zipKey }), {
      expiresIn: 3600,
    });
    console.log('key---5-');
    return { zipKey, url, totalFiles: files.length, skippedFiles: skipped };
  }
}

// src/zip/zip.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import * as path from 'path';
import { ZipBuildRequest, ZipBuildResult, FileItem } from '../dto/zip.dto';

@Injectable()
export class ZipService {
  // private readonly bucket = process.env.AWS_BUCKET_NAME!;
  private readonly bucket = 'jana-cityfinance-stg';
  // private readonly bucket = 'cityfinance-resources';
  constructor(private readonly s3: S3Client) {}

  // async buildZipToS3(req: ZipBuildRequest): Promise<ZipBuildResult> {
  async buildZipToS3(files: string[]): Promise<ZipBuildResult> {
    // const files: FileItem[] = req.data.flatMap((x) => x.files || []);
    if (!files.length) throw new Error('No files in request');

    const zipKey: string = `bundles/${Date.now()}-${Math.random().toString(36).slice(2)}.zip`;

    // Reuse if already exists
    const existing = await this.trySign(zipKey);
    if (existing) return { zipKey, url: existing, totalFiles: files.length, skippedFiles: 0 };

    // archiver -> pass -> multipart upload
    const pass = new PassThrough();
    const uploader = new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: zipKey, Body: pass, ContentType: 'application/zip' },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });

    const archive: archiver.Archiver = archiver('zip', { zlib: { level: 0 } }); // PDFs→level 0
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
    for (const f of files) {
      const key = f;
      const ext = path.extname(key) || '';
      // const baseRaw = (f.name?.trim() || path.basename(key)).replace(/[\\/]/g, '_');
      // const base = baseRaw.endsWith(ext) ? baseRaw : baseRaw + ext;
      const base = f;
      // console.log('zipping---', key);
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      } catch (e) {
        console.log('skip', key, e);
        skipped++;
        continue;
      }
      console.log('zipping', key);
      try {
        const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        const body = obj.Body as NodeJS.ReadableStream;
        const nameInZip = unique(base);
        await new Promise<void>((resolve) => {
          body.once('error', (e) => {
            console.log('skip read error', e);
            skipped++;
            resolve();
          });
          archive.append(body, { name: nameInZip });
          body.once('end', () => resolve());
        });
      } catch {
        skipped++;
      }
    }

    await archive.finalize();
    await uploader.done();

    let sizeBytes: number | undefined = undefined;
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: zipKey }));
      sizeBytes = Number(head.ContentLength || 0);
      // Optional: set cache control (requires re-PUT with metadata if you need strict headers)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: zipKey,
          CacheControl: 'public, max-age=86400',
          Body: '',
        } as any),
      );
    } catch {}

    const url = (await this.trySign(zipKey)) as string;
    return { zipKey, url, totalFiles: files.length, skippedFiles: skipped, sizeBytes };
  }

  private async trySign(zipKey: string): Promise<string | null> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: zipKey }));
      return await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.bucket, Key: zipKey }),
        { expiresIn: 3600 }, // 1h
      );
    } catch {
      return null;
    }
  }
}

// s3.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);

  public readonly client: S3Client;
  public readonly bucket: string;
  private readonly region: string;
  private readonly presign: number;

  constructor(cfg: ConfigService) {
    this.region = cfg.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = cfg.get<string>('AWS_BUCKET_NAME', '');
    this.presign = Number(cfg.get<string>('PRESIGN_EXPIRES', '604800')); // 7 days
    this.client = new S3Client({ region: this.region });
  }

  async headObject(Key: string) {
    await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
  }

  async getObjectStream(Key: string): Promise<Readable> {
    const out: GetObjectCommandOutput = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
    return out.Body! as Readable; // Node.js Readable
  }

  async getBuffer(url: string): Promise<Buffer> {
    try {
      const key = this.getKeyFromS3Url(url); // extract key from full S3 URL
      // this.logger.log(`Fetching buffer from S3 for key: ${key}`);
      const dataStream = await this.getObjectStream(key);
      const chunks: Uint8Array[] = [];
      for await (const chunk of dataStream) {
        chunks.push(chunk);
      }

      // IMPORTANT: standardize to Node Buffer
      return Buffer.from(Buffer.concat(chunks));
    } catch (e) {
      this.logger.error(`Error fetching buffer from S3`);
      // throw error;
      const status = e?.$metadata?.httpStatusCode;
      const code = e?.name;

      throw new Error(`S3 GetObject failed (code=${code}, status=${status}), message=${e.message}`);
    }
  }

  async presignGet(Key: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key }), { expiresIn: this.presign });
  }

  // Permanent public upload
  async uploadPublic(Key: string, Body: Buffer | ReadableStream | string, ContentType = 'application/zip') {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key,
        Body,
        ContentType,
        ACL: 'public-read',
      }),
    );
    return this.getPublicUrl(Key);
  }

  getPublicUrl(Key: string) {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${Key}`;
  }

  /**
   *
   * @param copySource // key with bucket name
   * @param destKey
   */
  async copyFileBetweenBuckets(copySource: string, destKey: string): Promise<void> {
    // this.logger.log(`Copying s3://${copySource} -> s3://${destBucket}/${destKey}`);

    const cmd = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destKey,
      CopySource: copySource,
      // You can set ACL / Metadata / StorageClass here if needed
    });

    await this.client.send(cmd);

    // this.logger.log(`✅ Copied to s3://${this.bucket}/${destKey}`);
  }

  getKeyFromS3Url(url: string): string {
    if (url.startsWith('/')) {
      return url.substring(1); // remove leading '/'
    }
    if (!url.startsWith('http')) {
      return url; // already a key
    }
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname.substring(1); // remove leading '/'

    // Remove leading slash and decode %20 etc.
    const key = decodeURIComponent(path).replace(/^\/+/, '');
    return key;
  }

  toS3Key(input: string): string {
    // If it's a full URL, extract pathname. If it's already a path/key, use as-is.
    let path = input;
    try {
      // Works for https://... or s3://... style URLs
      const u = new URL(input);
      path = u.pathname; // includes leading '/'
    } catch {
      // not a valid absolute URL; keep as provided
    }

    // Remove leading slash and decode %20 etc.
    const key = decodeURIComponent(path).replace(/^\/+/, '');

    return key;
  }

  async streamToBuffer(body: any): Promise<Buffer> {
    const stream = body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async getPdfBufferFromS3(urlOrKey: string): Promise<Buffer> {
    const Key = this.toS3Key(urlOrKey);

    try {
      const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
      if (!resp.Body) throw new Error('S3 GetObject returned empty Body');
      return await this.streamToBuffer(resp.Body);
    } catch (e: any) {
      // Log useful diagnostics; AWS SDK v3 errors often have `name` and `$metadata`
      const status = e?.$metadata?.httpStatusCode;
      const code = e?.name;
      throw new Error(`S3 GetObject failed (code=${code}, status=${status}), message=${e.message}`);
    }
  }

  getPdfPageCountFromBuffer(buffer: Buffer): number {
    // Simple PDF page count by counting "/Type /Page" occurrences
    const pdfText = buffer.toString('latin1'); // Use 'latin1' to preserve byte values
    const pageRegex = /\/Type\s*\/Page[^s]/g; // Match "/Type /Page" not followed by 's'
    const matches = pdfText.match(pageRegex);
    return matches ? matches.length : 0;
  }
}

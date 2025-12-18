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
    const key = this.getKeyFromS3Url(url); // extract key from full S3 URL
    const dataStream = await this.getObjectStream(key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of dataStream) {
      chunks.push(chunk);
    }

    // IMPORTANT: standardize to Node Buffer
    return Buffer.from(Buffer.concat(chunks));
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
    if (!url.startsWith('http')) {
      return url; // already a key
    }
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.substring(1); // remove leading '/'
  }
}

// s3.service.ts
import { Injectable } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Service {
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

  async getObjectStream(Key: string) {
    const out: GetObjectCommandOutput = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
    return out.Body!; // Node.js Readable
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
}

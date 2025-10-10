// s3.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand, HeadObjectCommand, GetObjectCommandOutput } from '@aws-sdk/client-s3';
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
    this.presign = Number(cfg.get<string>('PRESIGN_EXPIRES', '2592000')); // 30 days
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
}

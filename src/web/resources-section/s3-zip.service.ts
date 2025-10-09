// file: s3-zip.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3ZipService {
  private s3: S3Client;
  private bucket: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION')!,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucket = this.configService.get<string>('AWS_BUCKET_NAME');
  }

  // private s3 = new S3Client({
  //     region: this.configService.get<string>('AWS_REGION')!,
  //     credentials: {
  //         accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
  //         secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
  //     },
  // });

  async streamZip(keys: string[]): Promise<NodeJS.ReadableStream> {
    const bucket = this.bucket;
    const level = 9;
    const archive = archiver('zip', { zlib: { level } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);
    console.log('bucket1', bucket);

    for (const key of keys) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const data = await this.s3.send(command);
      const stream = data.Body as NodeJS.ReadableStream;
      archive.append(stream, { name: key.split('/').pop() }); // filename only
    }

    archive.finalize();
    return passThrough;
  }

  async getSizesForFiles(keys: string[]) {
    let totalSize = 0;
    const files: { key: string; size: number }[] = [];

    for (const key of keys) {
      try {
        const response = await this.s3.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: decodeURIComponent(key), // decode if key has %28 etc.
          }),
        );

        const size = response.ContentLength ?? 0;
        totalSize += size;
        files.push({ key, size });
      } catch (err) {
        console.error(`Error fetching size for key: ${key}`, err.message);
        files.push({ key, size: -1 }); // mark as missing
      }
    }

    return {
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      files,
    };
  }
}

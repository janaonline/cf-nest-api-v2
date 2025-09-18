import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as stream from 'stream';
import archiver from 'archiver';


@Injectable()
export class AwsS3Service {
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

        this.bucket = this.configService.get<string>('AWS_BUCKET');
    }

    async zipAndUpload(keys: string[], zipKey: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            try {
                const passThrough = new stream.PassThrough();

                // Upload ZIP directly to S3
                const uploadPromise = this.s3.send(
                    new PutObjectCommand({
                        Bucket: this.bucket,
                        Key: zipKey,
                        Body: passThrough,
                        ContentType: 'application/zip',
                    }),
                );

                const archive = archiver('zip', { zlib: { level: 9 } });
                archive.on('error', (err: Error) => reject(err));
                archive.pipe(passThrough);

                // Append each file from S3
                for (const key of keys) {
                    const s3Stream = await this.s3.send(
                        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
                    );
                    archive.append(s3Stream.Body as stream.Readable, {
                        name: key.split('/').pop(),
                    });
                }

                await archive.finalize();
                await uploadPromise;

                // Return presigned URL
                const presignedUrl = await getSignedUrl(
                    this.s3,
                    new GetObjectCommand({ Bucket: this.bucket, Key: zipKey }),
                    { expiresIn: 3600 }, // 1 hour
                );

                resolve(presignedUrl);
            } catch (err) {
                reject(err);
            }
        });
    }
}

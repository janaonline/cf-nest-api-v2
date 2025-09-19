// file: s3-zip.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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
}

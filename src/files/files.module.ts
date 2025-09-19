import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { AwsS3Service } from 'src/services/aws-s3.service';
import { S3ZipService } from './s3-zip.service';
import { S3Client } from '@aws-sdk/client-s3';

@Module({
  controllers: [FilesController],
  providers: [
    {
          provide: S3Client,
          useFactory: () =>
            new S3Client({
              region: process.env.AWS_REGION,
              credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
              },
            }),
        },
    AwsS3Service, FilesService, S3ZipService],
})
export class FilesModule {}

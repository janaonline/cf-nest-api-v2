import { Module } from '@nestjs/common';
import { S3Service } from 'src/core/s3/s3.service';
import { S3UploadController } from './s3-upload.controller';
import { S3UploadService } from './s3-upload.service';

@Module({
  controllers: [S3UploadController],
  providers: [S3UploadService, S3Service],
})
export class S3UploadModule {}

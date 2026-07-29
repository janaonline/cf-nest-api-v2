import { Module } from '@nestjs/common';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { S3UploadService } from './s3-upload.service';

@Module({
  imports: [S3Module],
  controllers: [FileController],
  providers: [S3Service, FileService, S3UploadService],
  exports: [S3UploadService],
})
export class FileModule {}

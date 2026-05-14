import { Module } from '@nestjs/common';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';
import { FileDownloadController } from './file-download.controller';

@Module({
  imports: [S3Module],
  controllers: [FileDownloadController],
  providers: [S3Service],
})
export class FileDownloadModule {}

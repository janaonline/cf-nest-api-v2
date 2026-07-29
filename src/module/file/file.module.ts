import { Module } from '@nestjs/common';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';
import { FileController } from './file.controller';
import { FileService } from './file.service';

@Module({
  imports: [S3Module],
  controllers: [FileController],
  providers: [S3Service, FileService],
})
export class FileModule {}

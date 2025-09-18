import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { AwsS3Service } from 'src/services/aws-s3.service';

@Module({
  controllers: [FilesController],
  providers: [AwsS3Service, FilesService],
})
export class FilesModule {}

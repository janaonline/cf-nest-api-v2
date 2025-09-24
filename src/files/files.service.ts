import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
// import { FileEntity } from './schemas/file.schema';
import { AwsS3Service } from '../services/aws-s3.service';

@Injectable()
export class FilesService {
  constructor(
    // @InjectModel(FileEntity.name) private fileModel: Model<FileEntity>,
    private readonly awsS3Service: AwsS3Service,
  ) {}

  listFiles(filter: string) {
    // Query MongoDB for matching files
    // return this.fileModel.find({ type: filter }).exec();
    return [];
  }

  async downloadFiles(filter: string) {
    // Step 1: Get files from DB
    // const files = await this.fileModel.find({ type: filter }).exec();
    const files = [];
    // const keys = files.map((f) => f.s3Key);
    const keys = [
      'https://jana-cityfinance-live.s3.ap-south-1.amazonaws.com/objects/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      'https://jana-cityfinance-live.s3.ap-south-1.amazonaws.com/objects/7c4399f4-1ad1-4a02-a467-f7d7940f5591.pdf',
    ];

    // Step 2: Generate unique zip key
    const zipKey = `downloads/${filter}-${Date.now()}.zip`;

    // Step 3: Zip + upload + get presigned link
    const url = await this.awsS3Service.zipAndUpload(
      keys,
      //   process.env.AWS_BUCKET,
      zipKey,
    );

    return { downloadUrl: url };
  }
}

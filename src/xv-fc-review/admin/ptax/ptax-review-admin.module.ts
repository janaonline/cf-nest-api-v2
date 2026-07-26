import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Service } from '../../../core/s3/s3.service';
import { XvFcPtaxReview, XvFcPtaxReviewSchema } from '../../../schemas/xv-fc-ptax-review.schema';
import { PtaxReviewAdminController } from './ptax-review-admin.controller';
import { PtaxReviewAdminService } from './ptax-review-admin.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: XvFcPtaxReview.name, schema: XvFcPtaxReviewSchema }])],
  controllers: [PtaxReviewAdminController],
  providers: [PtaxReviewAdminService, S3Service],
  exports: [PtaxReviewAdminService],
})
export class PtaxReviewAdminModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Service } from '../../../../../core/s3/s3.service';
import { FileModule } from '../../../../file/file.module';

import { PropertyTaxOpMapper, PropertyTaxOpMapperSchema } from '../../../../../schemas/property-tax-op-mapper.schema';
import { State, StateSchema } from '../../../../../schemas/state.schema';
import { Ulb, UlbSchema } from '../../../../../schemas/ulb.schema';
import { XvFcPtaxReview, XvFcPtaxReviewSchema } from '../../../../../schemas/xv-fc-ptax-review.schema';
import { Year, YearSchema } from '../../../../../schemas/year.schema';
import { PtaxReviewController } from './ptax-review.controller';
import { PtaxReviewService } from './ptax-review.service';

@Module({
  imports: [
    FileModule,
    MongooseModule.forFeature([
      { name: XvFcPtaxReview.name, schema: XvFcPtaxReviewSchema },
      { name: PropertyTaxOpMapper.name, schema: PropertyTaxOpMapperSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
    ]),
  ],
  controllers: [PtaxReviewController],
  providers: [PtaxReviewService, S3Service],
  exports: [PtaxReviewService],
})
export class PtaxReviewModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Service } from 'src/core/s3/s3.service';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcGtc, XviFcGtcSchema } from '../../../../schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory, XviFcGtcHistorySchema } from '../../../../schemas/xvi-fc/state/gtc-form-history.schema';
import { XviFcCommonModule } from '../../common/xvi-fc-common.module';
import { GtcController } from './gtc.controller';
import { GtcService } from './gtc.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcGtc.name, schema: XviFcGtcSchema },
      { name: XviFcGtcHistory.name, schema: XviFcGtcHistorySchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [GtcController],
  providers: [GtcService, S3Service],
  exports: [GtcService],
})
export class GtcModule {}

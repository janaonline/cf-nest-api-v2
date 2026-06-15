import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcSfcStatus, XviFcSfcStatusSchema } from '../../../../schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcSfcStatusHistory,
  XviFcSfcStatusHistorySchema,
} from '../../../../schemas/xvi-fc/state/sfc-status-history.schema';
import { XviFcCommonModule } from '../../common/xvi-fc-common.module';
import { SfcStatusController } from './sfc-status.controller';
import { SfcStatusService } from './sfc-status.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: XviFcSfcStatusHistory.name, schema: XviFcSfcStatusHistorySchema },
    ]),
    XviFcCommonModule,
  ],
  controllers: [SfcStatusController],
  providers: [SfcStatusService],
  exports: [SfcStatusService],
})
export class SfcStatusModule {}

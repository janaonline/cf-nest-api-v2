import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcSfcStatusHistory, XviFcSfcStatusHistorySchema } from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { XviFcGtcHistory, XviFcGtcHistorySchema } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistorySchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  ElectedUrbanLocalBodiesFormHistorySchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import { StateFormHistoryController } from './state-form-history.controller';
import { StateFormHistoryService } from './state-form-history.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcSfcStatusHistory.name, schema: XviFcSfcStatusHistorySchema },
      { name: XviFcGtcHistory.name, schema: XviFcGtcHistorySchema },
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaFormHistory.name, schema: DevolutionFormulaFormHistorySchema },
      { name: ElectedUrbanLocalBodiesFormHistory.name, schema: ElectedUrbanLocalBodiesFormHistorySchema },
      { name: XviFcUnspentStateFormHistory.name, schema: XviFcUnspentStateFormHistorySchema },
    ]),
  ],
  controllers: [StateFormHistoryController],
  providers: [StateFormHistoryService],
})
export class StateFormHistoryModule {}

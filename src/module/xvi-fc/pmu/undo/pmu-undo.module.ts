import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistorySchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  ElectedUrbanLocalBodiesFormHistorySchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  ElectedUrbanLocalBodiesRow,
  ElectedUrbanLocalBodiesRowSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  ElectedUrbanLocalBodiesRowHistory,
  ElectedUrbanLocalBodiesRowHistorySchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row-history.schema';
import {
  XviFcUnspentStateForm,
  XviFcUnspentStateFormSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  XviFcUnspentStateFormRowHistory,
  XviFcUnspentStateFormRowHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import { XviFcGtc, XviFcGtcSchema } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory, XviFcGtcHistorySchema } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import { XviFcSfcStatus, XviFcSfcStatusSchema } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcSfcStatusHistory,
  XviFcSfcStatusHistorySchema,
} from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { PmuUndoController } from './pmu-undo.controller';
import { PmuUndoRowFormsService } from './pmu-undo-rows.service';
import { PmuUndoService } from './pmu-undo.service';

/** The single "undo my PMU decision" feature: one endpoint, all five forms' undo logic in this folder. It
 *  talks to the forms' collections directly (like the PMU review modules themselves) and reuses the shared
 *  PMU helpers from `XviFcCommonModule`. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: XviFcSfcStatusHistory.name, schema: XviFcSfcStatusHistorySchema },
      { name: XviFcGtc.name, schema: XviFcGtcSchema },
      { name: XviFcGtcHistory.name, schema: XviFcGtcHistorySchema },
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaFormHistory.name, schema: DevolutionFormulaFormHistorySchema },
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: ElectedUrbanLocalBodiesFormHistory.name, schema: ElectedUrbanLocalBodiesFormHistorySchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
      { name: ElectedUrbanLocalBodiesRowHistory.name, schema: ElectedUrbanLocalBodiesRowHistorySchema },
      { name: XviFcUnspentStateForm.name, schema: XviFcUnspentStateFormSchema },
      { name: XviFcUnspentStateFormHistory.name, schema: XviFcUnspentStateFormHistorySchema },
      { name: XviFcUnspentStateFormRow.name, schema: XviFcUnspentStateFormRowSchema },
      { name: XviFcUnspentStateFormRowHistory.name, schema: XviFcUnspentStateFormRowHistorySchema },
    ]),
    XviFcCommonModule,
  ],
  controllers: [PmuUndoController],
  providers: [PmuUndoService, PmuUndoRowFormsService],
})
export class PmuUndoModule {}

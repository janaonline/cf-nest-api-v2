import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { ClaimLetterBatch, ClaimLetterBatchSchema } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb, ClaimLetterBatchUlbSchema } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock, ClaimLetterUlbLockSchema } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { GrantAllocation, GrantAllocationSchema } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { ClaimLetterModule } from 'src/module/xvi-fc/state/claim-letter/claim-letter.module';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionSchema,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { RequestExemptionMohuaModule } from '../request-exemption/request-exemption-mohua.module';
import { MohuaClaimLettersController } from './mohua-claim-letters.controller';
import { MohuaClaimLettersService } from './mohua-claim-letters.service';

/** MoHUA-side claim letter screens — read-only, decoupled from the State-side claim-letter module. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: ClaimLetterBatch.name, schema: ClaimLetterBatchSchema },
      { name: ClaimLetterBatchUlb.name, schema: ClaimLetterBatchUlbSchema },
      { name: ClaimLetterUlbLock.name, schema: ClaimLetterUlbLockSchema },
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      { name: XviFcEligibilityExemption.name, schema: XviFcEligibilityExemptionSchema },
    ]),
    XviFcCommonModule,
    ClaimLetterModule,
    RequestExemptionMohuaModule,
  ],
  controllers: [MohuaClaimLettersController],
  providers: [MohuaClaimLettersService],
})
export class MohuaClaimLettersModule {}

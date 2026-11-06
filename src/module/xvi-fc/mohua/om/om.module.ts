import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { GrantAllocation, GrantAllocationSchema } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { Om, OmLog, OmLogSchema, OmSchema } from 'src/schemas/xvi-fc/mohua/om.schema';
import { OmUlb, OmUlbSchema } from 'src/schemas/xvi-fc/mohua/om-ulb.schema';
import { ClaimLetterBatch, ClaimLetterBatchSchema } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb, ClaimLetterBatchUlbSchema } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { ClaimLetterModule } from 'src/module/xvi-fc/state/claim-letter/claim-letter.module';
import { S3Service } from 'src/core/s3/s3.service';
import { OmPdfService } from './om-pdf.service';
import { OmController } from './om.controller';
import { OmService } from './om.service';

/** MoHUA's Office Memorandums for verified claim letters (see this folder's CLAUDE.md). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Om.name, schema: OmSchema },
      { name: OmLog.name, schema: OmLogSchema },
      { name: OmUlb.name, schema: OmUlbSchema },
      { name: ClaimLetterBatch.name, schema: ClaimLetterBatchSchema },
      { name: ClaimLetterBatchUlb.name, schema: ClaimLetterBatchUlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
    ]),
    XviFcCommonModule,
    ClaimLetterModule,
  ],
  controllers: [OmController],
  providers: [OmService, OmPdfService, S3Service],
})
export class MohuaOmModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BudgetDocument, BudgetDocumentSchema } from 'src/schemas/budget-document.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { BudgetDocumentController } from './budget-document.controller';
import { BudgetDocumentService } from './budget-document.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BudgetDocument.name, schema: BudgetDocumentSchema },
      { name: Year.name, schema: YearSchema },
    ]),
    UlbEligibilityModule,
  ],
  controllers: [BudgetDocumentController],
  providers: [BudgetDocumentService],
  exports: [BudgetDocumentService],
})
export class BudgetDocumentModule {}

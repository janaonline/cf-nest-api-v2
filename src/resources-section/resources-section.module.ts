import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose/dist/mongoose.module';
import {
  BudgetDocument,
  BudgetDocumentSchema,
} from 'src/schemas/budget-document.schema';
import {
  DataCollectionForm,
  DataCollectionFormSchema,
} from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { ResourcesSectionController } from './resources-section.controller';
import { ResourcesSectionService } from './resources-section.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: DataCollectionForm.name, schema: DataCollectionFormSchema },
      { name: BudgetDocument.name, schema: BudgetDocumentSchema },
    ]),
  ],
  controllers: [ResourcesSectionController],
  providers: [ResourcesSectionService],
})
export class ResourcesSectionModule {}

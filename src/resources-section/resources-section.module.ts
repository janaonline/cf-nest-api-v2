import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose/dist/mongoose.module';
import { S3ZipService } from 'src/resources-section/s3-zip.service';
import { BudgetDocument, BudgetDocumentSchema } from 'src/schemas/budget-document.schema';
import { DataCollectionForm, DataCollectionFormSchema } from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { ResourcesSectionController } from './resources-section.controller';
import { ResourcesSectionService } from './resources-section.service';
import { ZipModule } from './zip/zip.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: DataCollectionForm.name, schema: DataCollectionFormSchema },
      { name: BudgetDocument.name, schema: BudgetDocumentSchema },
    ]),
    ZipModule,
  ],
  controllers: [ResourcesSectionController],
  providers: [ResourcesSectionService, S3ZipService],
})
export class ResourcesSectionModule {}

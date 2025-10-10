import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose/dist/mongoose.module';
import { BudgetDocument, BudgetDocumentSchema } from 'src/schemas/budget-document.schema';
import { DataCollectionForm, DataCollectionFormSchema } from 'src/schemas/data-collection-form-schema';
import { EmailList, EmailListSchema } from 'src/schemas/email-list';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { ResourcesSectionController } from './resources-section.controller';
import { ResourcesSectionService } from './resources-section.service';
import { S3ZipService } from './s3-zip.service';
import { ZipModule } from './zip/zip.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: DataCollectionForm.name, schema: DataCollectionFormSchema },
      { name: BudgetDocument.name, schema: BudgetDocumentSchema },
      { name: EmailList.name, schema: EmailListSchema },
    ]),
    ZipModule,
  ],
  controllers: [ResourcesSectionController],
  providers: [ResourcesSectionService, S3ZipService],
})
export class ResourcesSectionModule {}

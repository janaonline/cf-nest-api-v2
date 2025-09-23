import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose/dist/mongoose.module';
import {
  DataCollectionForm,
  DataCollectionFormSchema,
} from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { QueryTemplates } from 'src/shared/files/queryTemplates';
import { ResourcesSectionController } from './resources-section.controller';
import { ResourcesSectionService } from './resources-section.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: DataCollectionForm.name, schema: DataCollectionFormSchema },
    ]),
  ],
  controllers: [ResourcesSectionController],
  providers: [ResourcesSectionService, QueryTemplates],
})
export class ResourcesSectionModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { DataCollectionController } from './data-collection.controller';
import { DataCollectionService } from './data-collection.service';
import { DataCollection, DataCollectionSchema } from './entities/data-collection.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DataCollection.name, schema: DataCollectionSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
    ]),
  ],
  controllers: [DataCollectionController],
  providers: [DataCollectionService],
})
export class DataCollectionModule {}

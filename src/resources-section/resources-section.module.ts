import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose/dist/mongoose.module';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { ResourcesSectionController } from './resources-section.controller';
import { ResourcesSectionService } from './resources-section.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Ulb.name, schema: UlbSchema }])],
  controllers: [ResourcesSectionController],
  providers: [ResourcesSectionService],
})
export class ResourcesSectionModule {}

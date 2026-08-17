import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { UlbType, UlbTypeSchema } from 'src/schemas/ulb-type.schema';
import { UlbTypesController } from './ulb-types.controller';
import { UlbTypesService } from './ulb-types.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: UlbType.name, schema: UlbTypeSchema }]), UlbEligibilityModule],
  controllers: [UlbTypesController],
  providers: [UlbTypesService],
  exports: [UlbTypesService],
})
export class UlbTypesModule {}

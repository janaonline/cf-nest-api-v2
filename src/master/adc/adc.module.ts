import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Adc, AdcSchema } from 'src/schemas/adc.schema';
import { AdcController } from './adc.controller';
import { AdcService } from './adc.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Adc.name, schema: AdcSchema }])],
  controllers: [AdcController],
  providers: [AdcService],
})
export class AdcModule {}

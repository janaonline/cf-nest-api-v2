import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/module/auth/auth.module';
import { LineItemsLegendController } from './line-items-legend.controller';
import { LineItemsLegend, LineItemsLegendSchema } from './entities/line-items-legend.schema';
import { LineItemsLegendService } from './line-items-legend.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: LineItemsLegend.name, schema: LineItemsLegendSchema }]), AuthModule],
  controllers: [LineItemsLegendController],
  providers: [LineItemsLegendService],
  exports: [LineItemsLegendService],
})
export class LineItemsLegendsModule {}

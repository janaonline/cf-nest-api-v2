import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AfsMetric, AfsMetricDocument } from './entities/afs-metrics.schema';

@Controller('afs-digitization')
export class AfsDigitizationController {
  constructor(
    @InjectModel(AfsMetric.name, 'CONNECTION_2')
    private afsMetricModel: Model<AfsMetricDocument>,
  ) {}

  @Get()
  async test() {
    const result = await this.afsMetricModel.insertOne({});
    return result;
  }
}

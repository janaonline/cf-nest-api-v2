import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsMetric, AfsMetricDocument } from './entities/afs-metrics.schema';

@Controller('afs-digitization')
export class AfsDigitizationController {
  constructor(
    @InjectModel(AfsMetric.name, 'CONNECTION_2')
    private afsMetricModel: Model<AfsMetricDocument>,

    private afsService: AfsDigitizationService,
  ) {}

  // For dev only - To be removed.
  @Get()
  async test() {
    const result = await this.afsMetricModel.insertOne({});
    return result;
  }

  // TODO: verify token - Only 'AFS_ADMIN' role is allowed.
  @Get('afs-filters')
  async getAfsFilters() {
    return await this.afsService.getAfsFilters();
  }
}

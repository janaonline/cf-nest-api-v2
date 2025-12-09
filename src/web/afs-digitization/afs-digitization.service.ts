import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';
import { afsQuery } from './queries/afs-excel-files.query';
import { DigitizationJobData } from './dto/digitization-job-data';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class AfsDigitizationService {
  private readonly logger = new Logger(AfsDigitizationService.name);

  constructor(
    @InjectModel(State.name)
    private stateModel: Model<StateDocument>,

    @InjectModel(Ulb.name)
    private ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private yearModel: Model<YearDocument>,

    @InjectModel(AnnualAccountData.name)
    private readonly annualAccountModel: Model<AnnualAccountDataDocument>,

    @InjectModel(DigitizationLog.name, 'digitization_db')
    private readonly digitizationModel: Model<DigitizationLogDocument>,

    @InjectQueue('afsDigitization')
    private readonly digitizationQueue: Queue<DigitizationJobData>,
  ) {}

  async getAfsFilters() {
    const [states, ulbs, years] = await Promise.all([
      this.stateModel.find({ isActive: true }, { _id: 1, name: 1 }).sort({ name: 1 }),
      this.ulbModel
        .find({ isActive: true }, { _id: 1, name: 1, population: 1, state: 1, code: 1 })
        .populate('state', 'name')
        .sort({ name: 1 }),
      this.yearModel.find({ isActive: true }, { _id: 1, name: 1 }).sort({ name: -1 }),
    ]);

    // TODO: migration pending.
    return { states, ulbs, years };
  }

  async afsList(query: DigitizationReportQueryDto): Promise<any> {
    mongoose.set('debug', true);
    // const auditedYearObjectId = new Types.ObjectId(query.yearId);
    // const ulbObjectId = new Types.ObjectId(query.ulbId);
    const results = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    return results ? results[0] : null;
  }

  async getRequestLog(requestId: string): Promise<DigitizationLogDocument | null> {
    return this.digitizationModel.findOne({ RequestId: requestId }).exec();
  }

  async enqueueDigitizationJob(data: DigitizationJobData) {
    const job = await this.digitizationQueue.add('afsDigitization', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    });

    this.logger.log(`Enqueued digitization job ${job.id} for ULB ${data.ulb} (${data.sourceType})`);

    return { jobId: job.id };
  }
}

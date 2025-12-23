import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { buildPopulationMatch } from 'src/core/helpers/populationCategory.helper';
import {
  AfsExcelFile,
  AfsExcelFileDocument,
  AuditType,
  DigitizationStatuses,
} from 'src/schemas/afs/afs-excel-file.schema';
import { AnnualAccountData, AnnualAccountDataDocument } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogDocument } from 'src/schemas/digitization-log.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { DigitizationJobDto } from './dto/digitization-job.dto';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { afsCountQuery, afsQuery } from './queries/afs-excel-files.query';
import { documentTypes } from './constants/docTypes';

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

    @InjectModel(AfsExcelFile.name)
    private readonly afsExcelFileModel: Model<AfsExcelFileDocument>,

    @InjectModel(DigitizationLog.name, 'digitization_db')
    private readonly digitizationModel: Model<DigitizationLogDocument>,

    @InjectQueue('afsDigitization')
    private readonly digitizationQueue: Queue<DigitizationJobDto>,
  ) {}

  async getAfsFilters() {
    // const auditTypes = [
    //   { key: 'audited', name: 'Audited' },
    //   { key: 'unAudited', name: 'Unaudited' },
    // ];

    const auditTypes = Object.values(AuditType).map((type) => ({
      key: type,
      name: type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

    const digitizationStatuses = Object.values(DigitizationStatuses).map((status) => ({
      key: status,
      name: status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

    const populationCategories = ['All', '4M+', '1M-4M', '500K-1M', '100K-500K', '<100K'];
    const [states, ulbs, years] = await Promise.all([
      this.stateModel.find({ isActive: true, isPublish: true }, { _id: 1, name: 1 }).sort({ name: 1 }),
      this.ulbModel
        .find({ isActive: true, isPublish: true }, { _id: 1, name: 1, population: 1, state: 1, code: 1 })
        // .populate('state', 'name')
        .sort({ name: 1 }),
      // .limit(1000),
      this.yearModel.find({ isActive: true }, { _id: 1, year: 1 }).sort({ year: -1 }),
    ]);

    return {
      data: {
        states,
        ulbs,
        years,
        populationCategories,
        documentTypes,
        auditTypes,
        digitizationStatuses,
      },
    };
  }

  async getUlbs(params: {
    populationCategory: string;
    stateId?: string[];
    limit?: number;
  }): Promise<{ data: UlbDocument[] }> {
    const populationRange = buildPopulationMatch(params.populationCategory || '');
    const stateObjectIds = params.stateId ? params.stateId.map((id) => new Types.ObjectId(id)) : undefined;

    const data = await this.ulbModel
      .find(
        {
          isActive: true,
          isPublish: true,
          ...(params.populationCategory && populationRange),
          ...(stateObjectIds && { state: { $in: stateObjectIds } }),
        },
        { _id: 1, name: 1, population: 1, state: 1, code: 1 },
      )
      .sort({ name: 1 })
      .limit(params.limit || 2000);
    return { data };
  }

  async getFile(id: string) {
    return this.afsExcelFileModel.findById(id);
  }

  async afsList(query: DigitizationReportQueryDto): Promise<any> {
    // mongoose.set('debug', true);
    // const auditedYearObjectId = new Types.ObjectId(query.yearId);
    // const ulbObjectId = new Types.ObjectId(query.ulbId);
    // const results = await this.annualAccountModel.aggregate(afsQuery(query)).exec();
    const [data, countResult] = await Promise.all([
      this.annualAccountModel.aggregate(afsQuery(query)).exec(),
      this.annualAccountModel.aggregate<{ count: number }>(afsCountQuery(query)).exec(),
    ]);

    // this.logger.log(`AFS List fetched: ${data.length} records`, countResult);
    const totalCount: number = countResult[0]?.count ?? 0;
    return { data, totalCount };
  }

  async getRequestLog(requestId: string): Promise<DigitizationLogDocument | null> {
    return this.digitizationModel.findOne({ RequestId: requestId }).exec();
  }

  // async enqueueDigitizationJob(data: DigitizationJobDto) {
  //   const job = await this.digitizationQueue.add('afsDigitization', data, {
  //     attempts: 3,
  //     backoff: { type: 'exponential', delay: 10_000 },
  //     removeOnComplete: 200,
  //     removeOnFail: 1000,
  //   });

  //   this.logger.log(`Enqueued digitization job ${job.id} for ULB ${data.ulb} (${data.uploadedBy})`);

  //   return { jobId: job.id };
  // }
}

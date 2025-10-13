import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JobsOptions, Queue } from 'bullmq';
import { Model } from 'mongoose';
import { BudgetDocument, BudgetDocumentDoc } from 'src/schemas/budget-document.schema';
import { DataCollectionForm, DataCollectionFormDocument } from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { getBudgetPipeline, getRawFiles1920OnwardsPipeline, getRawFilesBefore1920Pipeline } from './constants';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { DataSetsRes, ZipJobRequest } from './zip/zip.types';
import { EmailList, EmailListDocument } from 'src/schemas/email-list';
const DOWNLOAD_TYPE = {
  'Raw Data PDF': 'Audited Financial Statement',
  'Budget PDF': 'Budget',
};

@Injectable()
export class ResourcesSectionService {
  private readonly logger = new Logger(ResourcesSectionService.name);

  constructor(
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(DataCollectionForm.name)
    private readonly dataCollectionModel: Model<DataCollectionFormDocument>,

    @InjectModel(BudgetDocument.name)
    private readonly budgetDocModel: Model<BudgetDocumentDoc>,

    @InjectModel(EmailList.name)
    private readonly emailListModel: Model<EmailListDocument>,

    @InjectQueue('zipResources')
    private readonly queue: Queue,
  ) {}

  /**
   * --------------------------------------------------------------------------------
   * Main entry: Determines which data source to query based on downloadType and year
   * --------------------------------------------------------------------------------
   */
  async getFiles(query: QueryResourcesSectionDto) {
    const { downloadType, ulb, state } = query;

    if (!ulb && !state) {
      this.logger.warn(`Missing ULB and State`);
      throw new BadRequestException({
        message: ['Either ULB or State is required.'],
        error: 'Bad Request',
        statusCode: 400,
      });
    }

    switch (downloadType) {
      case 'Raw Data PDF':
        return this.handleRawPdfDownload(query);

      // case 'Standardised Excel':
      //   return this.responseStructure(true, [], 'Development in-progress.');

      case 'Budget PDF':
        return this.getBudget(query);

      default:
        this.logger.error(`Unsupported downloadType`);
        throw new BadRequestException({
          message: [`Unsupported downloadType`],
          error: 'Bad Request',
          statusCode: 400,
        });
    }
  }

  private async handleRawPdfDownload(query: QueryResourcesSectionDto) {
    const endYearPart = query.year.split('-')[1];
    const endYear = parseInt(endYearPart, 10);

    if (isNaN(endYear)) {
      throw new BadRequestException({
        message: ['Invalid year format. Expected format: YYYY-YY'],
        error: 'Bad Request',
        statusCode: 400,
      });
    }

    return endYear > 19 ? this.getRawFiles1920Onwards(query) : this.getRawFilesBefore1920(query);
  }

  // Raw PDF files (2019-20 onwards)
  async getRawFiles1920Onwards(query: QueryResourcesSectionDto) {
    const pipeline = getRawFiles1920OnwardsPipeline(query);
    const results = await this.ulbModel.aggregate(pipeline).exec();
    return this.responseStructure(true, results);
  }

  // Raw PDF files (before 2019-20)
  async getRawFilesBefore1920(query: QueryResourcesSectionDto) {
    const pipeline = getRawFilesBefore1920Pipeline(query);
    const results = await this.dataCollectionModel.aggregate(pipeline).exec();
    return this.responseStructure(true, results);
  }

  // Budget files
  async getBudget(query: QueryResourcesSectionDto) {
    const pipeline = getBudgetPipeline(query);
    const results = await this.budgetDocModel.aggregate(pipeline).exec();
    return this.responseStructure(true, results);
  }

  // Response formatting helper
  private responseStructure(
    success: boolean,
    results: any[],
    message = `${results.length} ULB(s) found for selected filters.`,
  ) {
    return {
      success,
      message,
      data: results,
    };
  }

  /**
   * --------------------------------------------------------------------------------
   * Zip the files.
   * --------------------------------------------------------------------------------
   */
  async zipData(query: QueryResourcesSectionDto) {
    const response: DataSetsRes = await this.getFiles(query);

    // If Email is not verified return;
    const user = await this.emailListModel.findOne({ email: query.email }).lean();
    if (!user || !user.isVerified) {
      throw new BadRequestException('Email ID is not verified!');
    }

    // If ULB files are not available.
    if (response && response.data.length === 0) {
      return {
        status: false,
        message:
          'No data available for the selected filter. Please select different option(s) to proceed with the download.',
      };
    }

    // this.zipService.buildZipToS3(response);
    const downloadType = DOWNLOAD_TYPE[query.downloadType];
    const body: ZipJobRequest = {
      success: true,
      message: '',
      email: query.email,
      ulbData: response.data,
      userName: query.userName,
      downloadType,
    };

    // Add job to queue
    const opts: JobsOptions = {
      removeOnComplete: { age: 86400, count: 2000 },
      removeOnFail: 1000,
    };
    const job = await this.queue.add('zipResources', body, opts);

    return {
      message: "Success! Your state bundle is being prepared. We'll email you the files in about 30 minutes.",
      jobId: job.id,
      statusUrl: `/zip-jobs/${job.id}`,
      poll: true, // hint to client to poll this endpoint
    };
  }
}

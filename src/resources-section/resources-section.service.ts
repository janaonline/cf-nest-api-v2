import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BudgetDocument, BudgetDocumentDoc } from 'src/schemas/budget-document.schema';
import { DataCollectionForm, DataCollectionFormDocument } from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { getBudgetPipeline, getRawFiles1920OnwardsPipeline, getRawFilesBefore1920Pipeline } from './constants';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';

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
      case 'rawPdf':
        return this.handleRawPdfDownload(query);

      case 'standardizedExcel':
        return this.responseStructure(true, [], 'Development in-progress.');

      case 'budget':
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
    message = `${results.length} document(s) found for selected filters.`,
  ) {
    return {
      success,
      message,
      data: results,
    };
  }
}

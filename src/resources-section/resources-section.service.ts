import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BudgetDocument,
  BudgetDocumentDoc,
} from 'src/schemas/budget-document.schema';
import {
  DataCollectionForm,
  DataCollectionFormDocument,
} from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  getBudgetPipeline,
  getRawFiles1920OnwardsPipeline,
  getRawFilesBefore1920Pipeline,
} from './constants';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';

@Injectable()
export class ResourcesSectionService {
  constructor(
    @InjectModel(Ulb.name) private ulbModel: Model<UlbDocument>,
    @InjectModel(DataCollectionForm.name)
    private dataCollectionModel: Model<DataCollectionFormDocument>,
    @InjectModel(BudgetDocument.name)
    private budgetDocModel: Model<BudgetDocumentDoc>,
  ) {}

  // Call the functions based on downloadType.
  async getFiles(query: QueryResourcesSectionDto) {
    const { downloadType, year, ulb, state } = query;
    if (!ulb && !state) {
      return {
        message: ['Either ULB or State is required.'],
        error: 'Bad Request',
        statusCode: 400,
      };
    }

    switch (downloadType) {
      case 'rawPdf': {
        const endYear = Number(year.split('-')[1]);
        if (endYear > 19) {
          return await this.getRawFiles1920Onwards(query);
        } else {
          return await this.getRawFilesBefore1920(query);
        }
      }
      case 'standardizedExcel':
        return { msg: 'Dev in-progress' };

      case 'budget':
        return await this.getBudget(query);
    }
  }

  /**
   * ------------------------------------------------------
   * Get annual accounts raw file links (2019-20 onwards)
   * ------------------------------------------------------
   */
  async getRawFiles1920Onwards(query: QueryResourcesSectionDto) {
    const pipeline = getRawFiles1920OnwardsPipeline(query);
    const results: any[] = await this.ulbModel.aggregate(pipeline).exec();
    return this.responseStructure(true, results);
  }

  /**
   * ------------------------------------------------------
   * Get annual accounts raw file links (before 2019-20)
   * ------------------------------------------------------
   */
  async getRawFilesBefore1920(query: QueryResourcesSectionDto) {
    const pipeline = getRawFilesBefore1920Pipeline(query);
    const results: any[] = await this.dataCollectionModel
      .aggregate(pipeline)
      .exec();
    return this.responseStructure(true, results);
  }

  /**
   * ------------------------------------------------------
   * Get Budget file links
   * ------------------------------------------------------
   */
  async getBudget(query: QueryResourcesSectionDto) {
    const pipeline = getBudgetPipeline(query);
    const results: any[] = await this.budgetDocModel.aggregate(pipeline).exec();
    return this.responseStructure(true, results);
  }

  // Helper: Create response object.
  private responseStructure(success: boolean, results: any[]) {
    return {
      success,
      msg: `${results.length} document(s) found for searched options.`,
      data: results,
    };
  }
}

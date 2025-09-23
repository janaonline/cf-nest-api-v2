import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DataCollectionForm,
  DataCollectionFormDocument,
} from 'src/schemas/data-collection-form-schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { YEARS } from 'src/shared/files/constant';
import { QueryTemplates } from 'src/shared/files/queryTemplates';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';

const ANNUAL_ACCOUNTS_DOCS = [
  {
    name: 'Balance Sheet',
    dbKey: 'bal_sheet',
  },
  {
    name: 'Schedules To Balance Sheet',
    dbKey: 'bal_sheet_schedules',
  },
  {
    name: 'Income And Expenditure',
    dbKey: 'inc_exp',
  },
  {
    name: 'Schedules To Income And Expenditure',
    dbKey: 'inc_exp_schedules',
  },
  {
    name: 'Cash Flow Statement',
    dbKey: 'cash_flow',
  },
];

@Injectable()
export class ResourcesSectionService {
  constructor(
    @InjectModel(Ulb.name) private ulbModel: Model<UlbDocument>,
    @InjectModel(DataCollectionForm.name)
    private dataCollectionModel: Model<DataCollectionFormDocument>,
    private queryTemplate: QueryTemplates,
  ) {}

  // Call the functions based on downloadType.
  async getFiles(query: QueryResourcesSectionDto) {
    const { downloadType, year } = query;
    if (!(year in YEARS)) {
      return {
        message: ['Please pass a valid year between range 2015-16 to 2026-27'],
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
        return { msg: 'Dev in-progress' };
    }
  }

  // Get annual accounts raw file links (2019-20 onwards)
  async getRawFiles1920Onwards(query: QueryResourcesSectionDto) {
    const { year, auditType } = query;
    const yearId = year ? YEARS[year] : '606aaf854dff55e6c075d219';

    // Filters on Ulbs collection
    const matchCondition1 = this.getUlbMatchCondition(query);

    // Filters on AnnualAccounts collection.
    const matchCondition2 = {
      $expr: { $eq: ['$ulb', '$$ulbId'] },
      // "audited.submit_annual_accounts": true,
      // currentFormStatus: { $in: [ 4 ] }
    };
    if (yearId)
      matchCondition2[`${auditType}.year`] = new Types.ObjectId(yearId);

    const pipeline = [
      {
        $addFields: {
          popCat: this.queryTemplate.popCatQuerySwitch('$population'),
        },
      },
      { $match: matchCondition1 },
      {
        $lookup: {
          from: 'states',
          localField: 'state',
          foreignField: '_id',
          as: 'stateData',
        },
      },
      {
        $lookup: {
          from: 'annualaccountdatas',
          let: { ulbId: '$_id' },
          pipeline: [{ $match: matchCondition2 }],
          as: 'annualaccountdata',
        },
      },
      {
        $unwind: {
          path: '$annualaccountdata',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $project: {
          ulbId: '$_id',
          ulbName: '$name',
          state: 1,
          stateName: { $arrayElemAt: ['$stateData.name', 0] },
          auditType: auditType,
          year: year,
          files: ANNUAL_ACCOUNTS_DOCS.map((o) => ({
            name: o.name,
            url: `$annualaccountdata.${auditType}.provisional_data.${o.dbKey}.pdf.url`,
          })),
        },
      },
      // { $count: "count" }
    ];

    const results: any[] = await this.ulbModel.aggregate(pipeline).exec();
    return this.responseStructure(true, results);
  }

  // Get annual accounts raw file links (before 2019-20)
  async getRawFilesBefore1920(query: QueryResourcesSectionDto) {
    const { year, auditType, ulb, state, ulbType, popCat } = query;
    const yearKey = year.replace('-', '_');

    const matchCondition1 = {};
    if (ulb) matchCondition1['ulb'] = new Types.ObjectId(ulb);
    if (state) matchCondition1['state'] = new Types.ObjectId(state);

    const matchCondition2 = {
      fileUrl: { $ne: null },
      'ulbData.isPublish': true,
      'ulbData.isActive': true,
    };

    if (popCat) matchCondition2['popCat'] = popCat;
    if (ulbType)
      matchCondition2['ulbData.ulbType'] = new Types.ObjectId(ulbType);

    const pipeline = [
      { $match: matchCondition1 },
      {
        $addFields: {
          fileUrl: {
            $arrayElemAt: [`$documents.financial_year_${yearKey}.pdf.url`, 0],
          },
        },
      },
      {
        $lookup: {
          from: 'ulbs',
          localField: 'ulb',
          foreignField: '_id',
          as: 'ulbData',
        },
      },
      {
        $lookup: {
          from: 'states',
          localField: 'state',
          foreignField: '_id',
          as: 'stateData',
        },
      },
      {
        $unwind: {
          path: '$ulbData',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $addFields: {
          popCat: this.queryTemplate.popCatQuerySwitch('$ulbData.population'),
        },
      },
      { $match: matchCondition2 },
      {
        $project: {
          ulbId: '$ulbData._id',
          ulbName: '$ulbData.name',
          state: 1,
          stateName: {
            $arrayElemAt: ['$stateData.name', 0],
          },
          auditType,
          year,
          files: [
            {
              name: { $concat: ['$name', '_', year] },
              url: '$fileUrl',
            },
          ],
        },
      },
    ];

    const results: any[] = await this.dataCollectionModel
      .aggregate(pipeline)
      .exec();
    return this.responseStructure(true, results);
  }

  // Helper: Create matchCondition object - Ulbs collection.
  private getUlbMatchCondition(query: QueryResourcesSectionDto) {
    const { ulb, state, ulbType, popCat } = query;
    const condition = {
      isActive: true,
      isPublish: true,
    };
    if (ulb) condition['_id'] = new Types.ObjectId(ulb);
    if (state) condition['state'] = new Types.ObjectId(state);
    if (ulbType) condition['ulbType'] = new Types.ObjectId(ulbType);
    if (popCat) condition['popCat'] = popCat;
    return condition;
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

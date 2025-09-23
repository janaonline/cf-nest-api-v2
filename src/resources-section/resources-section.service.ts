import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { QueryTemplates } from 'src/shared/queryTemplates';
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
    @InjectModel(Ulb.name)
    private ulbModel: Model<UlbDocument>,
    private queryTemplate: QueryTemplates,
  ) {}

  // Call the functions based on downloadType.
  async getFiles(query: QueryResourcesSectionDto) {
    const { downloadType } = query;
    switch (downloadType) {
      case 'rawPdf':
        return await this.getRawFiles(query);

      case 'standardizedExcel':
        return { msg: 'Dev in-progress' };

      case 'budget':
        return { msg: 'Dev in-progress' };
    }
  }

  // Get annual accounts raw file links (2019-20 onwards)
  async getRawFiles(query: QueryResourcesSectionDto) {
    const { ulb, state, ulbType, popCat, year, auditType } = query;

    // Filters on Ulbs collection
    const matchCondition1 = {
      isActive: true,
      isPublish: true,
    };
    if (ulb) matchCondition1['_id'] = new Types.ObjectId(ulb);
    if (state) matchCondition1['state'] = new Types.ObjectId(state);
    if (ulbType) matchCondition1['ulbType'] = new Types.ObjectId(ulbType);
    if (popCat) matchCondition1['popCat'] = popCat;

    // Filters on AnnualAccounts collection.
    const matchCondition2 = {
      $expr: { $eq: ['$ulb', '$$ulbId'] },
      // "audited.submit_annual_accounts": true,
      // currentFormStatus: { $in: [ 4 ] }
    };
    if (year) matchCondition2[`${auditType}.year`] = new Types.ObjectId(year);

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

    const results = await this.ulbModel.aggregate(pipeline).exec();

    return {
      success: true,
      msg: `${results.length} document(s) found for searched options.`,
      data: results,
    };
  }
}

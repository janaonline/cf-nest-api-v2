import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { QueryAnnualAccountsDto } from './dto/query-annualaccounts.dto';

@Injectable()
export class AnnualAccountsService {
  constructor(
    @InjectModel(Ulb.name)
    private ulbModel: Model<UlbDocument>,
    private configService: ConfigService,
  ) {}

  // Get annual accounts raw file links (2019-20 onwards)
  async getRawFiles(query: QueryAnnualAccountsDto) {
    const { ulb, state, ulbType, popCat, year, auditType } = query;

    // TODO: Add validations/ Error response accordingly

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
    if (year) matchCondition2['audited.year'] = new Types.ObjectId(year);
    if (auditType) matchCondition2['auditType'] = new Types.ObjectId(year);

    const pipeline: any[] = [
      {
        $addFields: {
          popCat: {
            $switch: {
              branches: [
                { case: { $lt: ['$population', 100000] }, then: '<100K' },
                {
                  case: {
                    $and: [
                      { $gte: ['$population', 100000] },
                      { $lt: ['$population', 500000] },
                    ],
                  },
                  then: '100K-500K',
                },
                {
                  case: {
                    $and: [
                      { $gte: ['$population', 500000] },
                      { $lt: ['$population', 1000000] },
                    ],
                  },
                  then: '500K-1M',
                },
                {
                  case: {
                    $and: [
                      { $gte: ['$population', 1000000] },
                      { $lt: ['$population', 4000000] },
                    ],
                  },
                  then: '1M-4M',
                },
                { case: { $gte: ['$population', 4000000] }, then: '4M+' },
              ],
              default: 'Unknown',
            },
          },
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
          files: [
            {
              name: 'Balance Sheet',
              url: '$annualaccountdata.audited.provisional_data.bal_sheet.pdf.url',
            },
            {
              name: 'Schedules To Balance Sheet',
              url: '$annualaccountdata.audited.provisional_data.bal_sheet_schedules.pdf.url',
            },
            {
              name: 'Income And Expenditure',
              url: '$annualaccountdata.audited.provisional_data.inc_exp.pdf.url',
            },
            {
              name: 'Schedules To Income And Expenditure',
              url: '$annualaccountdata.audited.provisional_data.inc_exp_schedules.pdf.url',
            },
            {
              name: 'Cash Flow Statement',
              url: '$annualaccountdata.audited.provisional_data.cash_flow.pdf.url',
            },
          ],
        },
      },
      // { $count: "count" }
    ];

    const results = await this.ulbModel.aggregate(pipeline).exec();

    return {
      success: true,
      data: results,
    };
  }
}

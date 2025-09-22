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

  async findAll(query: QueryAnnualAccountsDto) {
    console.log('Query: ', query);
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
      {
        $match: {
          isActive: true,
          isPublish: true,
          // _id: new Types.ObjectId('5dd006d4ffbcc50cfd92c87c'),
          state: new Types.ObjectId('5dcf9d7316a06aed41c748ec'),
          // ulbType: new Types.ObjectId('5dcfa67543263a0e75c71697'),
          // popCat: '500K-1M',
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
        $lookup: {
          from: 'annualaccountdatas',
          let: { ulbId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$ulb', '$$ulbId'] },
                'audited.year': new Types.ObjectId('606aaf854dff55e6c075d219'),
                // "audited.submit_annual_accounts": true,
                // currentFormStatus: { $in: [ 4 ] }
              },
            },
          ],
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
          auditType: 'audited Make dynamic',
          year: '2020-21 Make dynamic',
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

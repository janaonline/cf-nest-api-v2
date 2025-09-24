import { Types } from 'mongoose';
import { YEARS } from 'src/shared/files/constant';
import { popCatQuerySwitch } from 'src/shared/files/queryTemplates';
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

/**
 * ------------------------------------------------------------------
 * Helper: Create pipeline/ query for getRawFiles1920Onwards()
 * ------------------------------------------------------------------
 * */
export const getRawFiles1920OnwardsPipeline = (
  query: QueryResourcesSectionDto,
) => {
  const { year, auditType } = query;
  const yearId = year ? YEARS[year] : '606aaf854dff55e6c075d219';

  // Filters on Ulbs collection
  const matchCondition1 = getUlbMatchCondition(query);

  // Filters on AnnualAccounts collection.
  const matchCondition2 = {
    $expr: { $eq: ['$ulb', '$$ulbId'] },
    // "audited.submit_annual_accounts": true,
    // currentFormStatus: { $in: [ 4 ] }
  };
  if (yearId) matchCondition2[`${auditType}.year`] = new Types.ObjectId(yearId);

  return [
    {
      $addFields: {
        popCat: popCatQuerySwitch('$population'),
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
};

// Helper: Create matchCondition object - Ulbs collection.
const getUlbMatchCondition = (query: QueryResourcesSectionDto) => {
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
};

/**
 * ------------------------------------------------------------------
 * Helper: Create pipeline/ query for getRawFilesBefore1920()
 * ------------------------------------------------------------------
 * */
export const getRawFilesBefore1920Pipeline = (
  query: QueryResourcesSectionDto,
) => {
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
  if (ulbType) matchCondition2['ulbData.ulbType'] = new Types.ObjectId(ulbType);

  return [
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
        popCat: popCatQuerySwitch('$ulbData.population'),
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
            name: { $concat: ['$ulbData.name', '_', year] },
            url: '$fileUrl',
          },
        ],
      },
    },
  ];
};

/**
 * ------------------------------------------------------------------
 * Helper: Create pipeline/ query for getBudget()
 * ------------------------------------------------------------------
 * */
export const getBudgetPipeline = (query: QueryResourcesSectionDto) => {
  const { ulb, popCat, ulbType, state, auditType, year } = query;

  const matchCondition1 = { 'yearsData.designYear': '2023-24' };
  if (ulb) matchCondition1['ulb'] = new Types.ObjectId(ulb);

  const matchCondition2 = {
    'ulbData.isActive': true,
    'ulbData.isPublish': true,
  };

  if (state) matchCondition2['ulbData.state'] = new Types.ObjectId(state);
  if (popCat) matchCondition2['ulbData.state'] = popCat;
  if (ulbType) matchCondition2['ulbData.ulbType'] = new Types.ObjectId(ulbType);

  return [
    {
      $unwind: {
        path: '$yearsData',
        preserveNullAndEmptyArrays: false,
      },
    },
    { $match: matchCondition1 },
    {
      $lookup: {
        from: 'ulbs',
        localField: 'ulb',
        foreignField: '_id',
        as: 'ulbData',
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
        popCat: popCatQuerySwitch('$ulbData.population'),
      },
    },
    { $match: matchCondition2 },
    {
      $lookup: {
        from: 'states',
        localField: 'ulbData.state',
        foreignField: '_id',
        as: 'stateData',
      },
    },
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
            name: { $concat: ['$ulbData.name', '_', year] },
            url: { $arrayElemAt: ['$yearsData.files.url', 0] },
          },
        ],
      },
    },
  ];
};

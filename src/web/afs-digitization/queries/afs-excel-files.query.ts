import { Types } from 'mongoose';
import { YearIdToLabel } from 'src/core/constants/years';
import { DOC_TYPES } from '../constants/docTypes';
import { DigitizationReportQueryDto } from '../dto/digitization-report-query.dto';
import { buildPopulationMatch } from 'src/core/helpers/populationCategory.helper';

export const afsQuery = (query: DigitizationReportQueryDto): any[] => {
  const auditedYearObjectId = new Types.ObjectId(query.yearId);
  // const ulbObjectIds = new Types.ObjectId(query.ulbId);

  const ulbObjectIds = query.ulbId ? query.ulbId.map((id) => new Types.ObjectId(id)) : undefined;
  const stateObjectIds = query.stateId ? query.stateId.map((id) => new Types.ObjectId(id)) : undefined;
  const yearLabel = YearIdToLabel[`${query.yearId}`];

  const populationRange = buildPopulationMatch(query.populationCategory || '');
  return [
    {
      $match: {
        'audited.year': auditedYearObjectId,
        ...(ulbObjectIds && { ulb: { $in: ulbObjectIds } }), // optional ulb filter
      },
    },
    // Join ULB collection to get ULB name / code / state id
    {
      $lookup: {
        from: 'ulbs', // <-- or "ulbs" if that's your collection name
        localField: 'ulb',
        foreignField: '_id',
        pipeline: [
          {
            $match: {
              isActive: true,
              isPublish: true,
              ...(stateObjectIds && { state: { $in: stateObjectIds } }),
              ...(query.populationCategory && populationRange),
            },
          },
        ],
        as: 'ulbDoc',
      },
    },
    { $unwind: '$ulbDoc' },
    { $sort: { 'ulbDoc.name': 1 } },
    { $skip: (query.page - 1) * query.limit }, // Pagination
    { $limit: query.limit },
    // {
    //   $match: {
    //     'ulbDoc.isActive': true,
    //     'ulbDoc.isPublish': true,
    //     ...(stateObjectIds && { state: { $in: stateObjectIds } }),
    //   },
    // },
    {
      $lookup: {
        from: 'afsexcelfiles',
        let: {
          fyId: '$audited.year', // annualaccountdatas.audited.year
          ulbId: '$ulb', // annualaccountdatas.ulb
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$financialYearId', '$$fyId'] }, // match year
                  { $eq: ['$ulb', '$$ulbId'] }, // match ulb
                  { $eq: ['$docType', DOC_TYPES[`${query.docType}`]] }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsexcelfiles',
      },
    },
    // { $unwind: '$afsexcelfiles' },
    {
      $unwind: {
        path: '$afsexcelfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'afsfiles',
        let: {
          fyId: '$afsexcelfiles.financialYear', // afsexcelfiles.financialYear
          ulbIds: '$afsexcelfiles.ulbId', // afsexcelfiles.ulb
          docType: '$afsexcelfiles.docType', // afsexcelfiles.docType
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ['$financialYear', '$$fyId'],
                  }, // match year
                  {
                    $eq: ['$ulbId', '$$ulbIds'],
                  }, // match ulb
                  {
                    $eq: ['$docType', '$$docType'],
                  }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsfiles',
      },
    },
    {
      $unwind: {
        path: '$afsfiles',
        preserveNullAndEmptyArrays: true,
      },
    },

    //   Join State collection to get State name
    {
      $lookup: {
        from: 'states',
        localField: 'ulbDoc.state',
        foreignField: '_id',
        pipeline: [
          {
            $match: { isActive: true, isPublish: true },
          },
        ],
        as: 'stateDoc',
      },
    },
    { $unwind: '$stateDoc' },

    // Shape the main document
    {
      $project: {
        _id: 1,
        ulb: 1,
        year: '$audited.year',
        [`${query.docType}`]: `$audited.provisional_data.${query.docType}.pdf`,
        currentFormStatus: 1,
        ulbSubmit: 1,
        status: 1,
        actionTakenByRole: 1,
        isDraft: 1,
        // bal_sheet: '$audited.provisional_data.bal_sheet.pdf',
        // inc_exp: '$audited.provisional_data.inc_exp.pdf',
        afsexcelfiles: 1,
        afsfiles: 1,
        createdAt: 1,
        isActive: 1,
        // 'afsexcelfiles.files.data': 0,

        ulbPopulation: '$ulbDoc.population',
        ulbName: '$ulbDoc.name',
        ulbCode: '$ulbDoc.code',
        stateId: '$ulbDoc.state',
        stateName: '$stateDoc.name',
        doctType: `${DOC_TYPES[`${query.docType}`]}`,
        yearLabel: yearLabel,
      },
    },
    // Unwind afsexcelfiles to have a single object instead of array
    // {
    //   $addFields: {
    //     afsexcelfiles: {
    //       $ifNull: [
    //         {
    //           $arrayElemAt: ['$afsexcelfiles', 0],
    //         },
    //         {},
    //       ],
    //     },
    //   },
    // },
    {
      $project: {
        'afsexcelfiles.files.data': 0,
      },
    },
    {
      $facet: {
        data: [
          { $sort: { ulbName: 1 } },
          { $skip: (query.page - 1) * query.limit }, // Pagination
          { $limit: query.limit },
        ],
        totalCount: [{ $count: 'count' }],
      },
    },
  ];
};

export const afsQueryDump = (query: DigitizationReportQueryDto): any[] => {
  const ulbObjectIds = query.ulbId ? query.ulbId.map((id) => new Types.ObjectId(id)) : undefined;
  return [
    {
      $match: {
        'audited.year': new Types.ObjectId(query.yearId),
        ...(ulbObjectIds && { ulb: { $in: ulbObjectIds } }),
      },
    },
    {
      $lookup: {
        from: 'afsexcelfiles',
        let: {
          fyId: '$audited.year', // annualaccountdatas.audited.year
          ulbId: '$ulb', // annualaccountdatas.ulb
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$financialYearId', '$$fyId'] }, // match year
                  { $eq: ['$ulb', '$$ulbId'] }, // match ulb
                  { $eq: ['$docType', DOC_TYPES[`${query.docType}`]] }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsexcelfiles',
      },
    },
    // { $unwind: '$afsexcelfiles' },
    {
      $unwind: {
        path: '$afsexcelfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'afsfiles',
        let: {
          fyId: '$afsexcelfiles.financialYear', // afsexcelfiles.financialYear
          ulbIds: '$afsexcelfiles.ulb', // afsexcelfiles.ulb
          docType: '$afsexcelfiles.docType', // afsexcelfiles.docType
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ['$financialYear', '$$fyId'],
                  }, // match year
                  {
                    $eq: ['$ulb', '$$ulbIds'],
                  }, // match ulb
                  {
                    $eq: ['$docType', '$$docType'],
                  }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsfiles',
      },
    },
    {
      $unwind: {
        path: '$afsfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
    // Join ULB collection to get ULB name / code / state id
    {
      $lookup: {
        from: 'ulbs', // <-- or "ulbs" if that's your collection name
        localField: 'ulb',
        foreignField: '_id',
        as: 'ulbDoc',
      },
    },
    { $unwind: '$ulbDoc' },
    { $match: { 'ulbDoc.isActive': true, 'ulbDoc.isPublish': true } },
    //   Join State collection to get State name
    {
      $lookup: {
        from: 'states',
        localField: 'ulbDoc.state',
        foreignField: '_id',
        as: 'stateDoc',
      },
    },
    { $unwind: '$stateDoc' },

    // Shape the main document
    {
      $project: {
        _id: 1,
        ulb: 1,
        year: '$audited.year',
        [`${query.docType}`]: `$audited.provisional_data.${query.docType}.pdf`,
        // bal_sheet: '$audited.provisional_data.bal_sheet.pdf',
        // inc_exp: '$audited.provisional_data.inc_exp.pdf',
        afsexcelfiles: 1,
        afsfiles: 1,
        createdAt: 1,
        // 'afsexcelfiles.files.data': 0,

        ulbPopulation: '$ulbDoc.population',
        ulbName: '$ulbDoc.name',
        ulbCode: '$ulbDoc.code',
        stateId: '$ulbDoc.state',
        stateName: '$stateDoc.name',
      },
    },
    // Unwind afsexcelfiles to have a single object instead of array
    // {
    //   $addFields: {
    //     afsexcelfiles: {
    //       $ifNull: [
    //         {
    //           $arrayElemAt: ['$afsexcelfiles', 0],
    //         },
    //         {},
    //       ],
    //     },
    //   },
    // },
    {
      $project: {
        'afsexcelfiles.files.data': 0,
      },
    },
  ];
};

export const afsQuery_bkp = (query: DigitizationReportQueryDto): any[] => {
  const auditedYearObjectId = new Types.ObjectId(query.yearId);
  // const ulbObjectIds = new Types.ObjectId(query.ulbId);

  const ulbObjectIds = query.ulbId ? query.ulbId.map((id) => new Types.ObjectId(id)) : undefined;
  const stateObjectIds = query.stateId ? query.stateId.map((id) => new Types.ObjectId(id)) : undefined;
  const yearLabel = YearIdToLabel[`${query.yearId}`];

  const populationRange = buildPopulationMatch(query.populationCategory || '');
  return [
    {
      $match: {
        'audited.year': auditedYearObjectId,
        ...(ulbObjectIds && { ulb: { $in: ulbObjectIds } }), // optional ulb filter
      },
    },
    // Join ULB collection to get ULB name / code / state id
    {
      $lookup: {
        from: 'ulbs', // <-- or "ulbs" if that's your collection name
        localField: 'ulb',
        foreignField: '_id',
        pipeline: [
          {
            $match: {
              isActive: true,
              isPublish: true,
              ...(stateObjectIds && { state: { $in: stateObjectIds } }),
              ...(query.populationCategory && populationRange),
            },
          },
        ],
        as: 'ulbDoc',
      },
    },
    { $unwind: '$ulbDoc' },
    // {
    //   $match: {
    //     'ulbDoc.isActive': true,
    //     'ulbDoc.isPublish': true,
    //     ...(stateObjectIds && { state: { $in: stateObjectIds } }),
    //   },
    // },
    {
      $lookup: {
        from: 'afsexcelfiles',
        let: {
          fyId: '$audited.year', // annualaccountdatas.audited.year
          ulbId: '$ulb', // annualaccountdatas.ulb
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$financialYearId', '$$fyId'] }, // match year
                  { $eq: ['$ulb', '$$ulbId'] }, // match ulb
                  { $eq: ['$docType', DOC_TYPES[`${query.docType}`]] }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsexcelfiles',
      },
    },
    // { $unwind: '$afsexcelfiles' },
    {
      $unwind: {
        path: '$afsexcelfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'afsfiles',
        let: {
          fyId: '$afsexcelfiles.financialYear', // afsexcelfiles.financialYear
          ulbIds: '$afsexcelfiles.ulbId', // afsexcelfiles.ulb
          docType: '$afsexcelfiles.docType', // afsexcelfiles.docType
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ['$financialYear', '$$fyId'],
                  }, // match year
                  {
                    $eq: ['$ulbId', '$$ulbIds'],
                  }, // match ulb
                  {
                    $eq: ['$docType', '$$docType'],
                  }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsfiles',
      },
    },
    {
      $unwind: {
        path: '$afsfiles',
        preserveNullAndEmptyArrays: true,
      },
    },

    //   Join State collection to get State name
    {
      $lookup: {
        from: 'states',
        localField: 'ulbDoc.state',
        foreignField: '_id',
        pipeline: [
          {
            $match: { isActive: true, isPublish: true },
          },
        ],
        as: 'stateDoc',
      },
    },
    { $unwind: '$stateDoc' },

    // Shape the main document
    {
      $project: {
        _id: 1,
        ulb: 1,
        year: '$audited.year',
        [`${query.docType}`]: `$audited.provisional_data.${query.docType}.pdf`,
        currentFormStatus: 1,
        ulbSubmit: 1,
        status: 1,
        actionTakenByRole: 1,
        isDraft: 1,
        // bal_sheet: '$audited.provisional_data.bal_sheet.pdf',
        // inc_exp: '$audited.provisional_data.inc_exp.pdf',
        afsexcelfiles: 1,
        afsfiles: 1,
        createdAt: 1,
        isActive: 1,
        // 'afsexcelfiles.files.data': 0,

        ulbPopulation: '$ulbDoc.population',
        ulbName: '$ulbDoc.name',
        ulbCode: '$ulbDoc.code',
        stateId: '$ulbDoc.state',
        stateName: '$stateDoc.name',
        doctType: `${DOC_TYPES[`${query.docType}`]}`,
        yearLabel: yearLabel,
      },
    },
    // Unwind afsexcelfiles to have a single object instead of array
    // {
    //   $addFields: {
    //     afsexcelfiles: {
    //       $ifNull: [
    //         {
    //           $arrayElemAt: ['$afsexcelfiles', 0],
    //         },
    //         {},
    //       ],
    //     },
    //   },
    // },
    {
      $project: {
        'afsexcelfiles.files.data': 0,
      },
    },
    {
      $facet: {
        data: [
          { $sort: { ulbName: 1 } },
          { $skip: (query.page - 1) * query.limit }, // Pagination
          { $limit: query.limit },
        ],
        totalCount: [{ $count: 'count' }],
      },
    },
  ];
};

export const ulbAfsQuery = (query: DigitizationReportQueryDto): any[] => {
  //   const auditedYearObjectId = new Types.ObjectId(query.yearId);
  //   const ulbObjectId = new Types.ObjectId(query.ulbId);

  return [
    { $match: { isActive: true, isPublish: true, ...(query.ulbId && { _id: query.ulbId }) } },
    //   Join State collection to get State name
    {
      $lookup: {
        from: 'states',
        localField: 'state',
        foreignField: '_id',
        as: 'stateDoc',
      },
    },
    { $unwind: '$stateDoc' },
    {
      $lookup: {
        from: 'annualaccountdatas',
        let: {
          // fyId: '$audited.year', // annualaccountdatas.audited.year
          ulbId: '$_id', // annualaccountdatas.ulb
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$audited.year', query.yearId] }, // match year
                  { $eq: ['$ulb', '$$ulbId'] }, // match ulb
                  // { $eq: ['$docType', DOC_TYPES[`${query.docType}`]] }, // match docType
                ],
              },
            },
          },
        ],
        as: 'annualaccountdatas',
      },
    },

    // { $unwind: '$afsexcelfiles' },
    {
      $unwind: {
        path: '$annualaccountdatas',
        preserveNullAndEmptyArrays: true,
      },
    },
    // {
    //   $match: {
    //     'audited.year': query.yearId,
    //     ...(query.ulbId && { ulb: query.ulbId }), // optional ulb filter
    //   },
    // },

    {
      $lookup: {
        from: 'afsexcelfiles',
        let: {
          fyId: '$annualaccountdatas.audited.year', // annualaccountdatas.audited.year
          ulbId: '$_id', // ulbs.ulb
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$financialYearId', '$$fyId'] }, // match year
                  { $eq: ['$ulb', '$$ulbId'] }, // match ulb
                  { $eq: ['$docType', DOC_TYPES[`${query.docType}`]] }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsexcelfiles',
      },
    },

    // { $unwind: '$afsexcelfiles' },
    {
      $unwind: {
        path: '$afsexcelfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'afsfiles',
        let: {
          fyId: '$afsexcelfiles.financialYear', // afsexcelfiles.financialYear
          ulbIds: '$afsexcelfiles.ulbId', // afsexcelfiles.ulb
          docType: '$afsexcelfiles.docType', // afsexcelfiles.docType
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ['$financialYear', '$$fyId'],
                  }, // match year
                  {
                    $eq: ['$ulbId', '$$ulbIds'],
                  }, // match ulb
                  {
                    $eq: ['$docType', '$$docType'],
                  }, // match docType
                ],
              },
            },
          },
        ],
        as: 'afsfiles',
      },
    },
    {
      $unwind: {
        path: '$afsfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
    // Join ULB collection to get ULB name / code / state id
    // {
    //   $lookup: {
    //     from: 'ulbs', // <-- or "ulbs" if that's your collection name
    //     localField: 'ulb',
    //     foreignField: '_id',
    //     as: 'ulbDoc',
    //   },
    // },
    // { $unwind: '$ulbDoc' },
    // { $match: { 'ulbDoc.isActive': true, 'ulbDoc.isPublish': true } },

    // Shape the main document
    {
      $project: {
        _id: 1,
        ulb: 1,
        year: '$audited.year',
        [`${query.docType}`]: `$annualaccountdatas.audited.provisional_data.${query.docType}.pdf`,
        // bal_sheet: '$audited.provisional_data.bal_sheet.pdf',
        // inc_exp: '$audited.provisional_data.inc_exp.pdf',
        afsexcelfiles: 1,
        afsfiles: 1,
        createdAt: '$annualaccountdatas.createdAt',
        // 'afsexcelfiles.files.data': 0,

        ulbPopulation: '$population',
        ulbName: '$name',
        ulbCode: '$code',
        stateId: '$state',
        stateName: '$stateDoc.name',
      },
    },
    {
      $project: {
        'afsexcelfiles.files.data': 0,
      },
    },
  ];
};

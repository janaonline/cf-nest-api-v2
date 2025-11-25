import { Types } from 'mongoose';
import { DigitizationReportQueryDto } from '../dto/digitization-report-query.dto';
import { DOC_TYPES } from '../constants/docTypes';

export const afsQuery = (query: DigitizationReportQueryDto): any[] => {
  //   const auditedYearObjectId = new Types.ObjectId(query.yearId);
  //   const ulbObjectId = new Types.ObjectId(query.ulbId);

  return [
    {
      $match: {
        'audited.year': query.yearId,
        ...(query.ulbId && { ulb: query.ulbId }), // optional ulb filter
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

import { PipelineStage, Types } from 'mongoose';

export const buildGetStateWiseDataPipeline = (
  stateId: Types.ObjectId,
): PipelineStage[] => [
  {
    $match: {
      stateId,
    },
  },
  {
    $lookup: {
      from: 'years',
      localField: 'yearId',
      foreignField: '_id',
      as: 'yearDetails',
    },
  },
  {
    $unwind: {
      path: '$yearDetails',
      preserveNullAndEmptyArrays: false,
    },
  },
  {
    $project: {
      _id: 0,
      stateId: 1,
      year: '$yearDetails.year',
      basic: { $ifNull: ['$basic', 0] },
      performance: { $ifNull: ['$performance', 0] },
    },
  },
  {
    $sort: {
      year: 1,
    },
  },
  {
    $group: {
      _id: '$stateId',
      totalAllocation: {
        $sum: {
          $add: ['$basic', '$performance'],
        },
      },
      tableData: {
        $push: {
          year: { $concat: ['FY', '$year'] },
          basic: '$basic',
          performance: '$performance',
          rawYear: '$year',
        },
      },
    },
  },
  {
    $lookup: {
      from: 'states',
      localField: '_id',
      foreignField: '_id',
      as: 'stateDetails',
    },
  },
  {
    $unwind: {
      path: '$stateDetails',
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $lookup: {
      from: 'ulbs',
      let: { currentStateId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $eq: ['$state', '$$currentStateId'],
            },
          },
        },
        {
          $count: 'count',
        },
      ],
      as: 'ulbCountData',
    },
  },
  {
    $addFields: {
      stateId: { $toString: '$_id' },
      stateName: '$stateDetails.name',
      totalUlbs: {
        $ifNull: [{ $arrayElemAt: ['$ulbCountData.count', 0] }, 0],
      },
      years: {
        $cond: {
          if: { $gt: [{ $size: '$tableData' }, 0] },
          then: {
            $let: {
              vars: {
                firstYear: { $arrayElemAt: ['$tableData.rawYear', 0] },
                lastYear: {
                  $arrayElemAt: [
                    '$tableData.rawYear',
                    { $subtract: [{ $size: '$tableData' }, 1] },
                  ],
                },
              },
              in: {
                $concat: [
                  { $substrCP: ['$$firstYear', 0, 4] },
                  '-',
                  { $substrCP: ['$$lastYear', 5, 2] },
                ],
              },
            },
          },
          else: '',
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      stateId: 1,
      stateName: 1,
      totalAllocation: 1,
      totalUlbs: 1,
      years: 1,
      tableData: {
        $map: {
          input: '$tableData',
          as: 'row',
          in: {
            year: '$$row.year',
            basic: '$$row.basic',
            performance: '$$row.performance',
          },
        },
      },
    },
  },
];
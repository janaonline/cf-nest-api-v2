import mongoose, { Types } from 'mongoose';
import { YearIdToLabel } from 'src/core/constants/years';
import { DOC_TYPES } from '../constants/docTypes';
import { DigitizationReportQueryDto } from '../dto/digitization-report-query.dto';
import { buildPopulationMatch } from 'src/core/helpers/populationCategory.helper';
import { DigitizationStatuses } from 'src/schemas/afs/afs-excel-file.schema';

function digitizationStatusCond(query: DigitizationReportQueryDto, isTotal = false) {
  const status = query.digitizationStatus;
  let cond = {};
  if (status === DigitizationStatuses.NOT_DIGITIZED) {
    cond = {
      $and: [
        { 'afsexcelfiles.ulbFile.digitizationStatus': { $exists: false } },
        // { 'afsexcelfiles.ulbFile.digitizationStatus': status },
        { 'afsexcelfiles.afsFile.digitizationStatus': { $exists: false } },
        // { 'afsexcelfiles.afsFile.digitizationStatus': status },
      ],
    };
  } else {
    cond = {
      $or: [
        { 'afsexcelfiles.ulbFile.digitizationStatus': status },
        { 'afsexcelfiles.afsFile.digitizationStatus': status },
      ],
    };
  }
  const pipeline: any[] = [{ $match: { ...cond } }];
  if (!isTotal) {
    pipeline.push({ $skip: (query.page - 1) * query.limit });
    pipeline.push({ $limit: query.limit });
  }

  return pipeline;
}

function getAfsXlFileLookupPipeline(query: DigitizationReportQueryDto) {
  const yearIdObj = new Types.ObjectId(query.yearId);
  return [
    {
      $lookup: {
        from: 'afs_xl_files',
        let: {
          ulbId: '$ulb', // annualaccountdatas.ulb
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$year', yearIdObj] }, // match year
                  { $eq: ['$ulb', '$$ulbId'] }, // match ulb
                  { $eq: ['$docType', query.docType] }, // match docType
                  { $eq: ['$auditType', query.auditType] }, // match auditType
                ],
              },
            },
          },
        ],
        as: 'afsexcelfiles',
      },
    },
    {
      $unwind: {
        path: '$afsexcelfiles',
        preserveNullAndEmptyArrays: true,
      },
    },
  ];
}

export const afsQuery = (query: DigitizationReportQueryDto): any[] => {
  // mongoose.set('debug', true);
  const yearObjectId = new Types.ObjectId(query.yearId);
  // const ulbObjectIds = new Types.ObjectId(query.ulbId);

  const ulbObjectIds = query.ulbId ? query.ulbId.map((id) => new Types.ObjectId(id)) : undefined;
  const stateObjectIds = query.stateId ? query.stateId.map((id) => new Types.ObjectId(id)) : undefined;
  const yearLabel = YearIdToLabel[`${query.yearId}`];
  const skip = (query.page - 1) * query.limit;
  // const digitizationStatusCondition = ;

  const populationRange = buildPopulationMatch(query.populationCategory || '');
  return [
    {
      $match: {
        // 'audited.year': yearObjectId,
        [`${query.auditType}.year`]: yearObjectId,
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
    { $sort: { [query.sortBy || 'ulbDoc.name']: query.sortOrder === 'desc' ? -1 : 1 } },
    ...(!query.digitizationStatus ? [{ $skip: skip }, ...(query.limit ? [{ $limit: query.limit }] : [])] : []), // Pagination
    ...getAfsXlFileLookupPipeline(query),
    ...(query.digitizationStatus ? digitizationStatusCond(query) : []),
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
        [`${query.docType}`]: `$${query.auditType}.provisional_data.${query.docType}.pdf`,
        currentFormStatus: 1,
        ulbSubmit: 1,
        status: 1,
        actionTakenByRole: 1,
        isDraft: 1,
        afsexcelfiles: 1,
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

    {
      $project: {
        'afsexcelfiles.ulbFile.data': 0,
        'afsexcelfiles.afsFile.data': 0,
      },
    },
  ];
};

export const afsCountQuery = (query: DigitizationReportQueryDto): any[] => {
  const yearObjectId = new Types.ObjectId(query.yearId);
  const ulbObjectIds = query.ulbId ? query.ulbId.map((id) => new Types.ObjectId(id)) : undefined;
  const stateObjectIds = query.stateId ? query.stateId.map((id) => new Types.ObjectId(id)) : undefined;

  const populationRange = buildPopulationMatch(query.populationCategory || '');
  return [
    {
      $match: {
        // 'audited.year': yearObjectId,
        [`${query.auditType}.year`]: yearObjectId,
        ...(ulbObjectIds && { ulb: { $in: ulbObjectIds } }), // optional ulb filter
      },
    },
    // Join ULB collection to get ULB name / code / state id
    {
      $lookup: {
        from: 'ulbs',
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
    ...(query.digitizationStatus ? getAfsXlFileLookupPipeline(query) : []),
    ...(query.digitizationStatus ? digitizationStatusCond(query, true) : []),
    {
      $count: 'count',
    },
  ];
};

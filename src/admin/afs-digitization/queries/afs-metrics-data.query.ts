export const AfsMetricsDataPipeline = [
  {
    $group: {
      _id: {
        ulb: '$ulb',
        year: '$year',
        docType: '$docType',
      },
      records: {
        $push: {
          auditType: '$auditType',
          afsFile: '$afsFile',
          ulbFile: '$ulbFile',
        },
      },
    },
  },

  // Normalize audited/unAudited records once
  {
    $project: {
      auditedRecord: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$records',
              as: 'rec',
              cond: { $eq: ['$$rec.auditType', 'audited'] },
            },
          },
          0,
        ],
      },
      unAuditedRecord: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$records',
              as: 'rec',
              cond: { $eq: ['$$rec.auditType', 'unAudited'] },
            },
          },
          0,
        ],
      },
    },
  },

  // Resolve preferred file for each audit type: afsFile first, else ulbFile
  {
    $project: {
      auditedResolved: {
        $cond: [{ $ifNull: ['$auditedRecord.afsFile', false] }, '$auditedRecord.afsFile', '$auditedRecord.ulbFile'],
      },
      unAuditedResolved: {
        $cond: [
          { $ifNull: ['$unAuditedRecord.afsFile', false] },
          '$unAuditedRecord.afsFile',
          '$unAuditedRecord.ulbFile',
        ],
      },
    },
  },

  // Compute flags and preferred records
  {
    $project: {
      digitizedResolved: {
        $ifNull: [
          {
            $cond: [{ $eq: ['$auditedResolved.digitizationStatus', 'digitized'] }, '$auditedResolved', null],
          },
          {
            $cond: [{ $eq: ['$unAuditedResolved.digitizationStatus', 'digitized'] }, '$unAuditedResolved', null],
          },
        ],
      },
      failedResolved: {
        $ifNull: [
          {
            $cond: [{ $eq: ['$auditedResolved.digitizationStatus', 'failed'] }, '$auditedResolved', null],
          },
          {
            $cond: [{ $eq: ['$unAuditedResolved.digitizationStatus', 'failed'] }, '$unAuditedResolved', null],
          },
        ],
      },
      hasDigitized: {
        $cond: [
          {
            $or: [
              { $eq: ['$auditedResolved.digitizationStatus', 'digitized'] },
              { $eq: ['$unAuditedResolved.digitizationStatus', 'digitized'] },
            ],
          },
          1,
          0,
        ],
      },
      hasFailed: {
        $cond: [
          {
            $or: [
              { $eq: ['$auditedResolved.digitizationStatus', 'failed'] },
              { $eq: ['$unAuditedResolved.digitizationStatus', 'failed'] },
            ],
          },
          1,
          0,
        ],
      },
    },
  },

  // Compute page counts from already-resolved records
  {
    $project: {
      hasDigitized: 1,
      hasFailed: 1,
      digitizedPages: { $ifNull: ['$digitizedResolved.noOfPages', 0] },
      failedPages: { $ifNull: ['$failedResolved.noOfPages', 0] },
    },
  },

  {
    $group: {
      _id: null,
      filesDigitized: {
        $sum: '$hasDigitized',
      },
      pagesDigitizedSuccessfully: {
        $sum: {
          $cond: [{ $eq: ['$hasDigitized', 1] }, '$digitizedPages', 0],
        },
      },
      failedFiles: {
        $sum: {
          $cond: [
            {
              $and: [{ $eq: ['$hasDigitized', 0] }, { $eq: ['$hasFailed', 1] }],
            },
            1,
            0,
          ],
        },
      },
      failedPages: {
        $sum: {
          $cond: [
            {
              $and: [{ $eq: ['$hasDigitized', 0] }, { $eq: ['$hasFailed', 1] }],
            },
            '$failedPages',
            0,
          ],
        },
      },
    },
  },

  {
    $project: {
      _id: 0,
      filesDigitized: 1,
      pagesDigitizedSuccessfully: 1,
      failedFiles: 1,
      failedPages: 1,
    },
  },
];

export enum FileType {
  ULB_FILE = 'ulbFile',
  AFS_FILE = 'afsFile',
}

export enum AuditType {
  AUDITED = 'audited',
  UNAUDITED = 'unAudited',
}

export enum UploadedBy {
  ULB = 'ULB',
  AFS = 'AFS',
}

export enum DigitizationStatuses {
  // NOT_STARTED = 'not-started',
  NOT_DIGITIZED = 'not-digitized',
  QUEUED = 'queued',
  DIGITIZED = 'digitized',
  FAILED = 'failed',
}

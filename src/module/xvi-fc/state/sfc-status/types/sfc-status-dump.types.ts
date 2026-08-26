import type { Types } from 'mongoose';

export interface SfcStatusDumpFilters {
  stateId?: string;
  yearId?: string;
  status?: number;
}

export interface SfcStatusPopulatedState {
  _id: Types.ObjectId;
  name: string;
}

export interface SfcStatusPopulatedYear {
  _id: Types.ObjectId;
  year: string;
}

export interface SfcStatusPopulatedUser {
  _id: Types.ObjectId;
  name: string;
}

/** Shape of a lean+populated SFC Status document returned by getForm(). */
export interface SfcStatusGetFormDoc {
  _id: Types.ObjectId;
  state: SfcStatusPopulatedState;
  data: Record<string, unknown>;
  currentFormStatus: number;
  createdBy?: SfcStatusPopulatedUser;
  updatedBy?: SfcStatusPopulatedUser;
  submittedBy?: SfcStatusPopulatedUser;
  createdAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date;
}

/** Shape of a lean+populated SFC Status document used only in dump row building. */
export interface SfcStatusDumpRecord {
  _id: Types.ObjectId;
  state: SfcStatusPopulatedState;
  year: SfcStatusPopulatedYear;
  formType: string;
  data: Record<string, unknown>;
  currentFormStatus: number;
  submittedBy?: SfcStatusPopulatedUser;
  submittedAt?: Date;
  createdBy: SfcStatusPopulatedUser;
  updatedBy: SfcStatusPopulatedUser;
  isActive: boolean;
  isDeleted?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** One flat row written to the SFC Status Excel dump sheet. */
export interface SfcStatusDumpRow {
  stateName: string;
  yearName: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  submittedBy: string;
  submittedAt: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  isActiveSfc: string;
  awardPeriod: string;
  awardPeriodDuration: string;
  sfcConstitutedForInterim: string;
  sfcAwardPeriodExtended: string;
  extensionOrder_fileName: string;
  extensionOrder_fileUrl: string;
  extensionOrder_fileSize: string;
  extensionOrder_mimeType: string;
  whichAwardPeriod: string;
  sfcReportStatus: string;
  reportSubmissionDate: string;
  sfcReport_fileName: string;
  sfcReport_fileUrl: string;
  sfcReport_fileSize: string;
  sfcReport_mimeType: string;
  atrReport_fileName: string;
  atrReport_fileUrl: string;
  atrReport_fileSize: string;
  atrReport_mimeType: string;
  isNewSfcConstituted: string;
  gazetteNotification_fileName: string;
  gazetteNotification_fileUrl: string;
  gazetteNotification_fileSize: string;
  gazetteNotification_mimeType: string;
  raiseAnIssue: string;
  checkboxConfirmation: string;
}

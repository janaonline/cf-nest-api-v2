import type { Types } from 'mongoose';
import type { FormStatusType } from 'src/common/constants/form-status.constants';
import type { DecisionInfo } from 'src/schemas/xvi-fc/annual-account.schema';

export type XviFcBankAccountProofMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface XviFcBankAccountProofFile {
  originalName: string;
  mimeType: XviFcBankAccountProofMimeType;
  pages: number | null;
  sizeKb: number;
  s3Key: string;
  sha256: string;
}

export interface XviFcBankDetails {
  name: string;
  branch: string;
  address: string;
  city: string;
  state?: string;
  micr: string | null;
}

export const DEFAULT_XVI_FC_BANK_ACCOUNT_PROOF_FILE: XviFcBankAccountProofFile = {
  originalName: '',
  mimeType: 'application/pdf',
  pages: null,
  sizeKb: 0,
  s3Key: '',
  sha256: '',
};

export interface XviFcBankAccountRecord {
  ulb: Types.ObjectId;
  designYear: Types.ObjectId;
  state: Types.ObjectId;
  ifscCode: string;
  bankDetails: Record<string, unknown>;
  accountNumberEncrypted: string;
  accountNumberHash: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
  proofFile: XviFcBankAccountProofFile;
  currentFormStatus: FormStatusType;
  stateDecision: DecisionInfo | null;
  mohuaDecision: DecisionInfo | null;
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface XviFcBankAccountResponse {
  _id: string;
  ulb: string;
  state: string;
  designYear: string;
  ifscCode: string;
  bankDetails: XviFcBankDetails;
  accountNumberMasked: string;
  accountNumberLast4: string;
  proofFile: XviFcBankAccountProofFile;
  currentFormStatus: FormStatusType;
  currentFormStatusLabel: string;
  stateDecision: DecisionInfo | null;
  mohuaDecision: DecisionInfo | null;
  submittedBy?: string;
  submittedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface XviFcIfscLookupResponse {
  ifscCode: string;
  bankDetails: XviFcBankDetails;
}

export interface VerifiedIfscDetails {
  bank?: string;
  branch?: string;
  address?: string;
  city?: string;
  state?: string;
  micr?: string | null;
}

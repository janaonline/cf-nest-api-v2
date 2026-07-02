import type { Types } from 'mongoose';
import type { FormStatusType } from 'src/common/constants/form-status.constants';

export interface XviFcBankAccountProof {
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string;
}

export interface XviFcBankDetails {
  name: string;
  branch: string;
  address: string;
  city: string;
  state?: string;
  micr: string | null;
}

export const DEFAULT_XVI_FC_BANK_ACCOUNT_PROOF: XviFcBankAccountProof = {
  fileName: '',
  fileUrl: '',
  fileSize: null,
  mimeType: '',
};

export interface XviFcBankAccountRecord {
  ulb: Types.ObjectId;
  designYear: Types.ObjectId;
  ifscCode: string;
  bankDetails: Record<string, unknown>;
  accountNumberEncrypted: string;
  accountNumberHash: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
  proof: XviFcBankAccountProof;
  currentFormStatus: FormStatusType;
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface XviFcBankAccountResponse {
  _id: string;
  ulb: string;
  designYear: string;
  ifscCode: string;
  bankDetails: XviFcBankDetails;
  accountNumberMasked: string;
  accountNumberLast4: string;
  proof: XviFcBankAccountProof;
  currentFormStatus: FormStatusType;
  currentFormStatusLabel: string;
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

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import {
  DEFAULT_XVI_FC_BANK_ACCOUNT_PROOF_FILE,
  type XviFcBankAccountProofFile,
  type XviFcBankAccountResponse,
  type XviFcBankDetails,
} from '../bank-account.types';

/** Signs an S3 key into a short-lived, viewable download URL — bank-account.service.ts binds this to FileTokenService. */
export type ProofFileUrlSigner = (s3Key: string) => string | null;

const AES_256_GCM_ALGORITHM = 'aes-256-gcm';
const AES_256_GCM_KEY_BYTES = 32;
const AES_256_GCM_IV_BYTES = 12;

interface BankAccountCryptoConfig {
  encryptionKey: Buffer;
  hashSecret: string;
}

export type SafeBankAccountResponse = XviFcBankAccountResponse;

type BankAccountRecordLike = object & {
  toObject?: () => Record<string, unknown>;
};

function readBankAccountCryptoConfig(): BankAccountCryptoConfig {
  const encodedEncryptionKey = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  if (!encodedEncryptionKey) {
    throw new Error('BANK_ACCOUNT_ENCRYPTION_KEY env variable is required for bank account encryption.');
  }

  const encryptionKey = Buffer.from(encodedEncryptionKey, 'base64');
  if (encryptionKey.length !== AES_256_GCM_KEY_BYTES) {
    throw new Error('BANK_ACCOUNT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  const hashSecret = process.env.BANK_ACCOUNT_HASH_SECRET;
  if (!hashSecret) {
    throw new Error('BANK_ACCOUNT_HASH_SECRET env variable is required for bank account hashing.');
  }

  return { encryptionKey, hashSecret };
}

export function encryptAccountNumber(accountNumber: string): string {
  const { encryptionKey } = readBankAccountCryptoConfig();
  const iv = randomBytes(AES_256_GCM_IV_BYTES);
  const cipher = createCipheriv(AES_256_GCM_ALGORITHM, encryptionKey, iv);
  const cipherText = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}:${authTag.toString('base64url')}:${cipherText.toString('base64url')}`;
}

export function decryptAccountNumber(encryptedValue: string): string {
  const { encryptionKey } = readBankAccountCryptoConfig();
  const [ivValue, authTagValue, cipherTextValue] = encryptedValue.split(':');

  if (!ivValue || !authTagValue || !cipherTextValue) {
    throw new Error('Encrypted account number must use iv:authTag:cipherText format.');
  }

  const iv = Buffer.from(ivValue, 'base64url');
  const authTag = Buffer.from(authTagValue, 'base64url');
  const cipherText = Buffer.from(cipherTextValue, 'base64url');
  const decipher = createDecipheriv(AES_256_GCM_ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(cipherText, undefined, 'utf8') + decipher.final('utf8');
}

export function hashAccountNumber(accountNumber: string): string {
  const { hashSecret } = readBankAccountCryptoConfig();
  return createHmac('sha256', hashSecret).update(accountNumber, 'utf8').digest('hex');
}

export function maskAccountNumber(accountNumber: string): string {
  const last4 = getAccountNumberLast4(accountNumber);
  return `${'*'.repeat(accountNumber.length - last4.length)}${last4}`;
}

export function getAccountNumberLast4(accountNumber: string): string {
  return accountNumber.slice(-4);
}

export function buildSafeBankAccountResponse(
  record: BankAccountRecordLike,
  signProofUrl: ProofFileUrlSigner,
): XviFcBankAccountResponse {
  const source =
    typeof record.toObject === 'function'
      ? record.toObject()
      : (record as Record<string, unknown>);
  const currentFormStatus = source.currentFormStatus as FormStatusType;
  const rawProofFile = {
    ...DEFAULT_XVI_FC_BANK_ACCOUNT_PROOF_FILE,
    ...((source.proofFile as Partial<XviFcBankAccountProofFile> | undefined) ?? {}),
  };
  const proofFile = { ...rawProofFile, fileUrl: rawProofFile.s3Key ? signProofUrl(rawProofFile.s3Key) : null };

  return {
    _id: toResponseString(source._id),
    ulb: toResponseString(source.ulb),
    state: toResponseString(source.state),
    designYear: toResponseString(source.designYear),
    ifscCode: (source.ifscCode as string | undefined) ?? '',
    bankDetails: normalizeBankDetails(source.bankDetails),
    accountNumberMasked: (source.accountNumberMasked as string | undefined) ?? '',
    accountNumberLast4: (source.accountNumberLast4 as string | undefined) ?? '',
    proofFile,
    currentFormStatus,
    // Existing records predating this field won't have it stored — fall back to computing it.
    currentFormStatusLabel: (source.currentFormStatusLabel as string | undefined) ?? getFormStatusLabel(currentFormStatus),
    stateDecision: (source.stateDecision as XviFcBankAccountResponse['stateDecision']) ?? null,
    mohuaDecision: (source.mohuaDecision as XviFcBankAccountResponse['mohuaDecision']) ?? null,
    submittedBy: toOptionalResponseString(source.submittedBy),
    submittedAt: toOptionalDateString(source.submittedAt),
    createdAt: toOptionalDateString(source.createdAt),
    updatedAt: toOptionalDateString(source.updatedAt),
  };
}

function normalizeBankDetails(value: unknown): XviFcBankDetails {
  const bankDetails = (value ?? {}) as Partial<XviFcBankDetails>;
  return {
    name: bankDetails.name ?? '',
    branch: bankDetails.branch ?? '',
    address: bankDetails.address ?? '',
    city: bankDetails.city ?? '',
    state: bankDetails.state,
    micr: bankDetails.micr ?? null,
  };
}

function toResponseString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'object' && 'toHexString' in value && typeof value.toHexString === 'function') {
    return value.toHexString();
  }
  if (typeof value === 'object' && '_id' in value && (value as { _id?: unknown })._id) {
    return toResponseString((value as { _id?: unknown })._id);
  }
  return String(value);
}

function toOptionalResponseString(value: unknown): string | undefined {
  return value ? toResponseString(value) : undefined;
}

function toOptionalDateString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

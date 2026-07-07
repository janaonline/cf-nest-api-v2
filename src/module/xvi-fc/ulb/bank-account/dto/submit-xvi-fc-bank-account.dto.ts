import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Match } from 'src/common/decorators/match.decorator';

export const ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_KB = 5120;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimUppercaseString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimNullableString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'isBankAccountProofFileS3Key', async: false })
class IsBankAccountProofFileS3KeyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    const normalizedValue = value.trim();
    if (!normalizedValue) return false;
    if (/^https?:\/\//i.test(normalizedValue)) return false;
    if (/^s3:\/\//i.test(normalizedValue)) return false;
    if (normalizedValue.includes('?')) return false;

    return /^xvi-fc\/bank-account\/[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(normalizedValue);
  }

  defaultMessage(): string {
    return 'proofFile.s3Key must be an unsigned xvi-fc/bank-account S3 object key.';
  }
}

@ValidatorConstraint({ name: 'isBankAccountProofFilePages', async: false })
class IsBankAccountProofFilePagesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const proofFile = args.object as XviFcBankAccountProofFileDto;
    if (proofFile.mimeType === 'application/pdf') {
      return Number.isInteger(value) && Number(value) > 0;
    }

    if (proofFile.mimeType === 'image/jpeg' || proofFile.mimeType === 'image/png') {
      return value === null;
    }

    return false;
  }

  defaultMessage(): string {
    return 'proofFile.pages must be a positive integer for PDFs and null for images.';
  }
}

export class XviFcBankDetailsDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  branch!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  address!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  city!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  state?: string;

  @Transform(trimNullableString)
  @IsOptional()
  @IsString()
  micr?: string | null;
}

export class XviFcBankAccountProofFileDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  originalName!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES)
  mimeType!: (typeof ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES)[number];

  @Validate(IsBankAccountProofFilePagesConstraint)
  pages!: number | null;

  @IsNumber()
  @Min(0.01)
  @Max(MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_KB)
  sizeKb!: number;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @Validate(IsBankAccountProofFileS3KeyConstraint)
  s3Key!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-fA-F0-9]{64}$/, { message: 'proofFile.sha256 must be a 64-character hex string.' })
  sha256!: string;
}

export class SubmitXviFcBankAccountDto {
  @IsMongoId()
  @IsNotEmpty()
  ulbId!: string;

  @IsMongoId()
  @IsNotEmpty()
  designYearId!: string;

  @Transform(trimUppercaseString)
  @IsString()
  @IsNotEmpty()
  @Matches(IFSC_REGEX, { message: 'ifscCode must be a valid Indian IFSC code.' })
  ifscCode!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(ACCOUNT_NUMBER_REGEX, { message: 'accountNumber must contain 9 to 18 digits only.' })
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  @Match('accountNumber', { message: 'confirmAccountNumber must match accountNumber.' })
  confirmAccountNumber!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcBankDetailsDto)
  bankDetails!: XviFcBankDetailsDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcBankAccountProofFileDto)
  proofFile!: XviFcBankAccountProofFileDto;
}

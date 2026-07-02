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
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Match } from 'src/common/decorators/match.decorator';

export const ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimUppercaseString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimNullableString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'isBankAccountProofFileUrl', async: false })
class IsBankAccountProofFileUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    const normalizedValue = value.trim();
    if (!normalizedValue) return false;

    if (/^https?:\/\/\S+$/i.test(normalizedValue)) return true;
    if (/^s3:\/\/[^\s]+$/i.test(normalizedValue)) return true;

    return /^[A-Za-z0-9][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*$/.test(normalizedValue);
  }

  defaultMessage(): string {
    return 'proof.fileUrl must be a valid URL, S3 URL, or S3 file path.';
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

export class XviFcBankAccountProofDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @Validate(IsBankAccountProofFileUrlConstraint)
  fileUrl!: string;

  // SFC-style file objects store fileSize as bytes; submit requires a known size.
  @IsNumber()
  @Min(1)
  @Max(MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES)
  fileSize!: number;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES)
  mimeType!: (typeof ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES)[number];
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
  @Type(() => XviFcBankAccountProofDto)
  proof!: XviFcBankAccountProofDto;
}

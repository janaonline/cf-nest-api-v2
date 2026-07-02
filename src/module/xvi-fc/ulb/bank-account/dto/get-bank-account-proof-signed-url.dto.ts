import { IsIn, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES,
  MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES,
} from './submit-xvi-fc-bank-account.dto';

export class GetBankAccountProofSignedUrlDto {
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @IsMongoId()
  @IsNotEmpty()
  designYearId!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsNumber()
  @Min(1)
  @Max(MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES)
  fileSize!: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES)
  mimeType!: (typeof ALLOWED_BANK_ACCOUNT_PROOF_MIME_TYPES)[number];
}

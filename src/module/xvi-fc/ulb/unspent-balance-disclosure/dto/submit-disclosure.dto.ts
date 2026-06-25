import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class DisclosureDocDto {
  @IsString()
  @IsNotEmpty()
  filepath: string;

  @IsString()
  @IsNotEmpty()
  originalName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sizeKb?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  pages?: number;
}

export class BankAccountEntryDto {
  @IsString()
  @Matches(/^\d{9,18}$/, { message: 'Account number must contain 9–18 digits only.' })
  accountNumber: string;

  @IsInt({ message: 'Unspent balance must be a whole number.' })
  @Min(-9_999_999_999, { message: 'Unspent balance cannot be less than −9,999,999,999.' })
  @Max(9_999_999_999,  { message: 'Unspent balance cannot exceed 9,999,999,999.' })
  unspentBalance: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one supporting document is required per account.' })
  @ValidateNested({ each: true })
  @Type(() => DisclosureDocDto)
  documents: DisclosureDocDto[];
}

export class FcPeriodManualDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one bank account entry is required.' })
  @ValidateNested({ each: true })
  @Type(() => BankAccountEntryDto)
  bankAccounts: BankAccountEntryDto[];
}

export class FcPeriodDto {
  @ValidateNested()
  @Type(() => FcPeriodManualDto)
  manual: FcPeriodManualDto;
}

export class SubmitDisclosureDto {
  @IsMongoId()
  designYearId: string;

  @ValidateNested()
  @Type(() => FcPeriodDto)
  fc14: FcPeriodDto;

  @ValidateNested()
  @Type(() => FcPeriodDto)
  fc15: FcPeriodDto;
}

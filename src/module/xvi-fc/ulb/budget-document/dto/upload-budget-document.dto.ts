import { Transform } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const MAX_BUDGET_DOCUMENT_FILE_SIZE_KB = 20480; // 20 MB

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

@ValidatorConstraint({ name: 'isBudgetDocumentS3Key', async: false })
class IsBudgetDocumentS3KeyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    const normalizedValue = value.trim();
    if (!normalizedValue) return false;
    if (/^https?:\/\//i.test(normalizedValue)) return false;
    if (/^s3:\/\//i.test(normalizedValue)) return false;
    if (normalizedValue.includes('?')) return false;

    // Structural check only — folder must be budgets/<designYear>/<filename>.pdf. The service
    // re-validates the EXACT budgets/{designYear}/ prefix once designYear is resolved from the
    // Year lookup (mirrors bank-account's DTO-level generic check + service-level exact check).
    return /^budgets\/[^/]+\/[A-Za-z0-9._-]+\.pdf$/i.test(normalizedValue);
  }

  defaultMessage(): string {
    return 'file.s3Key must be an unsigned budgets/{designYear}/ S3 object key ending in .pdf.';
  }
}

export class UploadBudgetDocumentDto {
  @IsMongoId()
  @IsNotEmpty()
  designYearId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  originalName!: string;

  @IsNumber()
  @Min(0.01)
  @Max(MAX_BUDGET_DOCUMENT_FILE_SIZE_KB)
  sizeKb!: number;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @Validate(IsBudgetDocumentS3KeyConstraint)
  s3Key!: string;
}

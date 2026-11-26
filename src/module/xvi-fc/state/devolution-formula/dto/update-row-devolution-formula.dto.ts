import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRowDevolutionFormulaDto {
  // Whole Rupees only — no decimals. A proportional split across many ULBs essentially never
  // divides evenly; rejecting fractional amounts (rather than rounding) keeps row sums exact.
  @IsOptional()
  @IsInt()
  @Min(0)
  totalGrantAllocation?: number;

  // Not settable: both instalments are always Total / 2, and updateRow refuses any other value
  // (docs/adr/0002). Kept so a sent value gets that clear error, not forbidNonWhitelisted's.
  @IsOptional()
  @IsNumber()
  installment1Amount?: number;

  @IsOptional()
  @IsNumber()
  installment2Amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  devolutionFormula?: string;
}

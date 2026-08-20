import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRowDevolutionFormulaDto {
  // Whole Rupees only — no decimals. A proportional split across many ULBs essentially never
  // divides evenly; rejecting fractional amounts (rather than rounding) keeps row sums exact.
  @IsOptional()
  @IsInt()
  @Min(0)
  totalGrantAllocation?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  installment1Amount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  installment2Amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  devolutionFormula?: string;
}

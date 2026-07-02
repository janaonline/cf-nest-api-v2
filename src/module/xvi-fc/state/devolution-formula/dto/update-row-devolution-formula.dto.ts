import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRowDevolutionFormulaDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalGrantAllocation?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  installment1Amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  installment2Amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  devolutionFormula?: string;
}

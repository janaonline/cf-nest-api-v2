import { IsIn, IsOptional, IsString } from 'class-validator';
import { ACCOUNT_HEAD_VALUES, type AccountHead } from '../constants';

export class FinancialDataTemplateQueryDto {
  @IsString()
  @IsOptional()
  templateVersion?: string;

  @IsIn(ACCOUNT_HEAD_VALUES)
  @IsOptional()
  accountHead?: AccountHead;
}

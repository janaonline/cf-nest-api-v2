import { IsIn, IsOptional, IsString } from 'class-validator';
import * as lineItemsLegendTypes from '../types';

export class FinancialDataTemplateQueryDto {
  @IsString()
  @IsOptional()
  templateVersion?: string;

  @IsIn(lineItemsLegendTypes.ACCOUNT_HEAD_VALUES)
  @IsOptional()
  accountHead?: lineItemsLegendTypes.AccountHead;
}

import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import * as lineItemsLegendTypes from '../types';

export class ListLineItemsLegendQueryDto {
  @IsString()
  @IsOptional()
  templateVersion: string = lineItemsLegendTypes.DEFAULT_TEMPLATE_VERSION;

  @IsIn(lineItemsLegendTypes.ACCOUNT_HEAD_VALUES)
  @IsOptional()
  accountHead?: lineItemsLegendTypes.AccountHead;

  @IsString()
  @IsOptional()
  majorCode?: string;

  @IsString()
  @IsOptional()
  parentCode?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  level?: number;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page: number = 1;

  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  @Type(() => Number)
  limit: number = 50;
}

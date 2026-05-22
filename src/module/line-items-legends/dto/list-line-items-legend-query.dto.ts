import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ACCOUNT_HEAD_VALUES, DEFAULT_TEMPLATE_VERSION, type AccountHead } from '../constants';

export class ListLineItemsLegendQueryDto {
  @IsString()
  @IsOptional()
  templateVersion: string = DEFAULT_TEMPLATE_VERSION;

  @IsIn(ACCOUNT_HEAD_VALUES)
  @IsOptional()
  accountHead?: AccountHead;

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

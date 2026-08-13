import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import * as types from '../types';
import { LineItemRuleDto } from './line-item-rule.dto';

export class CreateLineItemsLegendDto {
  @IsString()
  @IsNotEmpty()
  nmamCode!: string;

  @IsIn(types.ACCOUNT_HEAD_VALUES)
  accountHead!: types.AccountHead;

  @IsString()
  @IsNotEmpty()
  majorCode!: string;

  @IsString()
  @IsOptional()
  parentCode?: string | null;

  @IsString()
  @IsNotEmpty()
  segmentCode!: string;

  @IsArray()
  @IsString({ each: true })
  segmentPath!: string[];

  @IsArray()
  @IsString({ each: true })
  codePath!: string[];

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  desc?: string;

  @IsInt()
  @Min(1)
  level!: number;

  @IsInt()
  sortOrder!: number;

  @IsString()
  @IsOptional()
  templateVersion: string = types.DEFAULT_TEMPLATE_VERSION;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isComputed?: boolean;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LineItemRuleDto)
  rules?: types.Rule[];
}

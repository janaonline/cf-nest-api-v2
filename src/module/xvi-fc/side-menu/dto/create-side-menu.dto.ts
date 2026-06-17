import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export enum MenuItemType {
  HEADER    = 'header',
  SEPARATOR = 'separator',
  ITEM      = 'item',
  GROUP     = 'group',
}

export enum MenuSection {
  TOP    = 'top',
  BOTTOM = 'bottom',
}

export class CreateSideMenuDto {
  @ApiProperty({ example: 'ULB', description: 'Role this item belongs to' })
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiProperty({ example: '6801f2e3a4b5c6d7e8f90123', description: 'Year ObjectId' })
  @IsMongoId()
  year: string;

  @ApiProperty({ enum: MenuSection })
  @IsEnum(MenuSection)
  section: MenuSection;

  @ApiProperty({ description: 'Sort order within section or group', example: 1 })
  @IsNumber()
  @Min(1)
  sequence: number;

  @ApiProperty({ enum: MenuItemType })
  @IsEnum(MenuItemType)
  type: MenuItemType;

  @ApiProperty({ example: 'Overview' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'bi bi-speedometer2' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ example: 'overview' })
  @IsOptional()
  @IsString()
  featureKey?: string;

  @ApiPropertyOptional({ example: ['/xvifc'], description: 'Only for header type' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  routerLink?: string[];

  @ApiPropertyOptional({ example: '6801f2e3a4b5c6d7e8f90124', description: 'Parent group ObjectId. Null for top-level items.' })
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

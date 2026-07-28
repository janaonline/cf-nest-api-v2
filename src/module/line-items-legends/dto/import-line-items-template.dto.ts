import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class ImportLineItemsTemplateDto {
  @IsString()
  @IsOptional()
  templateVersion?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  dryRun?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  lineItems!: Record<string, unknown>[];
}

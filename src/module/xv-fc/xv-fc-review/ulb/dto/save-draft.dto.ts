import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class DraftLineItemDto {
  @ApiProperty({ example: '110', description: 'Line-item code, matches the code field from the detail response' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  flagged: boolean;

  @ApiProperty({ required: false, example: 6863200000, description: 'The ULB-claimed correct value for this line item' })
  @IsOptional()
  @IsNumber()
  proposedValue?: number;

  @ApiProperty({ required: false, example: 'This figure looks too low compared to our records' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class XvFcSaveDraftDto {
  @ApiProperty({ type: [DraftLineItemDto], description: 'Only send the line items being changed in this call' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftLineItemDto)
  lineItems: DraftLineItemDto[];
}

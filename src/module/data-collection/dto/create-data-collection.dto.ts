import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';
import type { LineItemsMap } from '../entities/data-collection.schema';
const lineItemsExample = {
  '1': 150,
  '1_1': 10,
  '1_2': 10,
  '1_3': 10,
  '1_4': 10,
  '1_5': 10,
  '1_6': 10,
  '1_7': 10,
  '1_8': 10,
  '1_9': 10,
  '1_10': 10,
  '1_11': 10,
  '1_12': 10,
  '1_13': 10,
  '1_14': 10,
  '1_15': 10,
};

export class CreateDataCollectionDto {
  @ApiProperty({
    example: '5dd24729437ba31f7eb42eee',
    description: 'ULB Id',
  })
  @IsMongoId()
  @IsNotEmpty()
  ulbId: string;

  @ApiProperty({
    example: '606aafb14dff55e6c075d3ae',
    description: 'Year Id',
  })
  @IsMongoId()
  @IsNotEmpty()
  yearId: string;

  @ApiProperty({
    example: lineItemsExample,
    description: 'Line items',
  })
  @IsNotEmpty()
  lineItems: LineItemsMap;
}

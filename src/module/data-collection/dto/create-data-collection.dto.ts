import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';
import * as dataCollectionSchema from '../entities/data-collection.schema';
const lineItemsExample = {
  '1': 150,
  '1.1': 10,
  '1.2': 10,
  '1.3': 10,
  '1.4': 10,
  '1.5': 10,
  '1.6': 10,
  '1.7': 10,
  '1.8': 10,
  '1.9': 10,
  '1.10': 10,
  '1.11': 10,
  '1.12': 10,
  '1.13': 10,
  '1.14': 10,
  '1.15': 10,
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
  lineItems: dataCollectionSchema.LineItems;
}

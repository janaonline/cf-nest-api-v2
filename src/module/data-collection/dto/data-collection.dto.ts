import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';
import { dataCollectionApiPayload } from '../constant';
import type { LineItemsMap } from '../entities/data-collection.schema';

export class DataCollectionDto {
  @ApiProperty({
    example: dataCollectionApiPayload.ulbId,
    description: 'ULB Id',
  })
  @IsMongoId()
  @IsNotEmpty()
  ulbId: string;

  @ApiProperty({
    example: dataCollectionApiPayload.yearId,
    description: 'Year Id',
  })
  @IsMongoId()
  @IsNotEmpty()
  yearId: string;

  @ApiProperty({
    example: dataCollectionApiPayload.lineItems,
    description: 'Line items',
  })
  @IsNotEmpty()
  lineItems: LineItemsMap;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class GetStateDashboardParamsDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the State.',
  })
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @ApiProperty({
    description: 'MongoDB ObjectId of the XVI-FC design year.',
  })
  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;
}

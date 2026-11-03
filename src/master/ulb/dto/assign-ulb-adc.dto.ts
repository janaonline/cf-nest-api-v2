import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class AssignUlbAdcDto {
  @ApiProperty({
    description: 'The ADC that will own this ULB. null moves it back to the State DMA.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsMongoId()
  adcId?: string | null;
}

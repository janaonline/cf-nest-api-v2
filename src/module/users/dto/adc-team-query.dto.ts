import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class AdcTeamQueryDto {
  @ApiPropertyOptional({
    description: 'Which ADC. Required for a State DMA caller; ignored for an ADC user (their own ADC is used).',
  })
  @IsOptional()
  @IsMongoId()
  adcId?: string;
}

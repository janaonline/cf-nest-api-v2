import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateUlbDto {
  @ApiProperty({
    description:
      'Partial field values keyed by the FieldConfig.key from the ULB_MASTER form-json definition. ' +
      'Only the provided keys are validated and updated.',
    example: { population: 254246, wards: 50 },
  })
  @IsObject()
  data: Record<string, unknown>;
}

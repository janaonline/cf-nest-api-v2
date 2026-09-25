import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class CreateUlbDto {
  @ApiProperty({
    description:
      'Field values keyed by the FieldConfig.key from the ULB_MASTER form-json definition ' +
      '(GET /form-json/by-type/ULB_MASTER). Validated dynamically against that field config.',
    example: {
      code: 'AP001',
      name: 'Vizianagaram Municipal Corporation',
      state: '64f0c8b1e1b1c2a1b8a1a111',
      ulbType: '64f0c8b1e1b1c2a1b8a1a222',
      district: 'Vizianagaram',
      censusCode: '802542',
      primaryContactName: 'K. Suresh Babu',
      primaryContactDesignation: 'Commissioner',
      primaryContactEmail: 'commissioner@ulb.gov.in',
      primaryContactMobile: '9849001234',
    },
  })
  @IsObject()
  data: Record<string, unknown>;
}

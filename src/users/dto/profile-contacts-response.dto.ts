import { ApiProperty } from '@nestjs/swagger';

export class ProfileContactsResponseDto {
  @ApiProperty({ example: 'Ramesh Kumar' })
  commissionerName: string;

  @ApiProperty({ example: 'commissioner@ulb.gov.in' })
  commissionerEmail: string;

  @ApiProperty({ example: '9123456780' })
  commissionerConatactNumber: string;

  @ApiProperty({ example: 'Suresh Patel' })
  accountantName: string;

  @ApiProperty({ example: 'accounts@ulb.gov.in' })
  accountantEmail: string;

  @ApiProperty({ example: '9000001111' })
  accountantConatactNumber: string;
}

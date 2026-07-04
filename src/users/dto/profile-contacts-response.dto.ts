import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UlbDetailsDto {
  @ApiProperty({ example: 'Greater Visakhapatnam Municipal Corporation' })
  name: string;

  @ApiProperty({ example: 'AP067' })
  code: string;

  @ApiProperty({ example: 'Andhra Pradesh' })
  stateName: string;
}

export class RegisteredMunicipalInfoDto {
  @ApiProperty({ example: 'Andhra Pradesh' })
  stateName: string;

  @ApiProperty({ example: 'Municipal Corporation' })
  ulbType: string;

  @ApiProperty({ example: '80294' })
  censusCode: string;

  @ApiProperty({ example: 'AP067' })
  ulbCode: string;

  @ApiProperty({ example: 681.96 })
  area: number;

  @ApiProperty({ example: 2035922 })
  population: number;

  @ApiProperty({ example: 98 })
  wards: number;
}

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

  @ApiPropertyOptional({ type: UlbDetailsDto })
  ulbDetails: UlbDetailsDto | null;

  @ApiPropertyOptional({ type: RegisteredMunicipalInfoDto })
  registeredMunicipalInfo: RegisteredMunicipalInfoDto | null;
}

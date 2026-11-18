import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** The ADC Admin's details. Same rules as a State team invite (InviteStateMemberDto). */
export class AdcAdminInputDto {
  @ApiProperty({ example: 'Anil Das' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'anil.das@btc.gov.in' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.toLowerCase().trim() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile!: string;

  @ApiProperty({ example: 'Principal Secretary' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  designation!: string;
}

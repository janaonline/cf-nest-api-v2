import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AdcAdminInputDto } from './adc-admin-input.dto';

export const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAdcDto {
  @ApiProperty()
  @IsMongoId()
  stateId!: string;

  @ApiProperty({ example: 'Bodoland Territorial Council', maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: AdcAdminInputDto, description: 'The ADC Admin, invited by email together with the ADC' })
  @ValidateNested()
  @Type(() => AdcAdminInputDto)
  admin!: AdcAdminInputDto;

  @ApiPropertyOptional({
    enum: ['invite', 'restore'],
    description: "invite (default); restore reactivates the Admin's account if it was removed earlier",
  })
  @IsOptional()
  @IsIn(['invite', 'restore'])
  action?: 'invite' | 'restore';
}

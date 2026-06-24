import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  EULB_CENSUS_CODE_MAX_LENGTH,
  EULB_ULB_NAME_MAX_LENGTH,
} from '../constants/elected-urban-local-bodies.constants';

export class UpdateElectedUrbanLocalBodiesRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(EULB_CENSUS_CODE_MAX_LENGTH)
  censusCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EULB_ULB_NAME_MAX_LENGTH)
  ulbName?: string;

  @IsOptional()
  electedBodyStatus?: string;

  @IsOptional()
  dateOfConstitution?: string;

  @IsOptional()
  dateOfExpiry?: string;

  @IsOptional()
  remarks?: string;
}

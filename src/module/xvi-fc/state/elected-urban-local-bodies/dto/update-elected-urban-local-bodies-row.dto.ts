import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { ELECTED_BODY_STATUSES } from '../constants/elected-urban-local-bodies.constants';

export class UpdateElectedUrbanLocalBodiesRowDto {
  @IsOptional()
  @IsString()
  @IsIn(ELECTED_BODY_STATUSES)
  electedBodyStatus?: string;

  @IsOptional()
  @IsISO8601()
  dateOfConstitution?: string;

  @IsOptional()
  @IsISO8601()
  dateOfExpiry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  remarks?: string;
}

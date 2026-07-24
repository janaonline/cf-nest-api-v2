import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `@MaxLength` here is a payload-size safety cap only, not the business limit — class-validator
 * decorators run at request-validation time and can't read the DB-driven limit. The real
 * censusCode (10)/ulbName (250) length rules are enforced DB-drivenly downstream in
 * `ElectedUrbanLocalBodiesValidator` (via `extractDateConfig`'s censusCodeMaxLength/ulbNameMaxLength).
 */
const PAYLOAD_SAFETY_MAX_LENGTH = 500;

export class UpdateElectedUrbanLocalBodiesRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(PAYLOAD_SAFETY_MAX_LENGTH)
  censusCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PAYLOAD_SAFETY_MAX_LENGTH)
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

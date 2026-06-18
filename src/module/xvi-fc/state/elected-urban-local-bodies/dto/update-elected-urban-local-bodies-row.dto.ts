import { IsOptional } from 'class-validator';

export class UpdateElectedUrbanLocalBodiesRowDto {
  @IsOptional()
  electedBodyStatus?: string;

  @IsOptional()
  dateOfConstitution?: string;

  @IsOptional()
  dateOfExpiry?: string;

  @IsOptional()
  remarks?: string;
}

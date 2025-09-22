import { IsOptional, IsString } from 'class-validator';

export class QueryAnnualAccountsDto {
  @IsOptional() @IsString() ulb?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() ulbType?: string;
  @IsOptional() @IsString() popCat?: string;
  @IsOptional() @IsString() year?: string;
  @IsOptional() @IsString() auditType?: string;
}

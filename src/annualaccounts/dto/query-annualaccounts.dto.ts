import { IsOptional, IsString } from 'class-validator';

export class QueryAnnualAccountsDto {
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() ulbType?: string;
  @IsOptional() @IsString() popCat?: string;
  @IsOptional() @IsString() year?: string;
}

import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional, IsString } from 'class-validator';

export class QueryFormJsonDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsMongoId()
  design_year?: string;

  /** Coerced from query-string "true"/"false" to boolean. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}

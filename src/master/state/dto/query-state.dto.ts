import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class QueryStateDto {
  @ApiPropertyOptional({ description: 'When true, excludes Union Territories from the result.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'false' ? false : value === 'true' ? true : value))
  @IsBoolean()
  excludeUT?: boolean;
}

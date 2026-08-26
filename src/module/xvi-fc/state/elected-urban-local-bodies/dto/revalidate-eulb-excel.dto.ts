import { IsNumber, IsOptional } from 'class-validator';

export class RevalidateEulbExcelDto {
  @IsOptional()
  @IsNumber()
  ulbCount?: number;
}

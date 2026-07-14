import { Type } from 'class-transformer';
import { IsMongoId, IsNotEmpty, IsNumber, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';

export class ValidateElectedUrbanLocalBodiesExcelDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsOptional()
  @IsNumber()
  ulbCount?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  electedBodyExcelFile!: XviFcFileRefDto;
}

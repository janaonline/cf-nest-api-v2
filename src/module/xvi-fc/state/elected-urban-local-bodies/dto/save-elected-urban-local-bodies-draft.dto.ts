import { Type } from 'class-transformer';
import { IsBoolean, IsMongoId, IsNotEmpty, IsNumber, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';

class SaveEulbDraftDataDto {
  @IsOptional()
  @IsNumber()
  ulbCount?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  electedBodyExcelFile?: XviFcFileRefDto;

  @IsOptional()
  @IsBoolean()
  checkboxConfirmation?: boolean;
}

export class SaveElectedUrbanLocalBodiesDraftDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SaveEulbDraftDataDto)
  data!: SaveEulbDraftDataDto;
}

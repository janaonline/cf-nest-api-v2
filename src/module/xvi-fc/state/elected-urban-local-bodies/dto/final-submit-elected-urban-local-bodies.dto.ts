import { Type } from 'class-transformer';
import { IsBoolean, IsMongoId, IsNotEmpty, IsNumber, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';

class FinalSubmitEulbDataDto {
  @IsOptional()
  @IsNumber()
  ulbCount?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  electedBodyExcelFile!: XviFcFileRefDto;

  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  signedElectedbodyFile!: XviFcFileRefDto;

  @IsBoolean()
  checkboxConfirmation!: boolean;
}

export class FinalSubmitElectedUrbanLocalBodiesDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => FinalSubmitEulbDataDto)
  data!: FinalSubmitEulbDataDto;
}

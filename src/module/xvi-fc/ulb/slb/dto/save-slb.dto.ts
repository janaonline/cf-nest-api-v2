import { IsMongoId, IsNotEmpty, IsObject, IsOptional } from 'class-validator';

export class SaveSlbDto {
  @IsMongoId()
  @IsOptional()
  ulbId?: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  data!: Record<string, unknown>;
}

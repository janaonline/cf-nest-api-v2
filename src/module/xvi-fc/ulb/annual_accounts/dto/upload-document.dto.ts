import { IsIn, IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class UploadDocumentDto {
  @IsMongoId()
  ulbId: string;

  @IsMongoId()
  designYearId: string;

  @IsIn(['auditedData', 'unauditedData'])
  section: string;

  @IsString()
  @IsNotEmpty()
  requirementId: string;

  @IsString()
  @IsNotEmpty()
  docId: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsMongoId()
  yearId: string;

  @IsString()
  @IsNotEmpty()
  year: string;
}

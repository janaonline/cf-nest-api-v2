import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class S3UrlItemDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsOptional()
  fileUrl?: string;

  @IsNumber()
  @IsOptional()
  fileSize?: number | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  pages?: number;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsString()
  @IsOptional()
  folder?: string;

  @IsUUID()
  @IsOptional()
  uploadId?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  expiresIn?: number;
}

export interface S3UrlResult {
  url: string;
  fileAlias: string;
  fileUrl: string;
  path: string;
  fileSize: number | null | undefined;
  pages: number | undefined;
  uploadId?: string;
}

import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @IsString()
  @IsOptional()
  uploadId?: string;

  @IsInt()
  @Min(1)
  @Max(604800)
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

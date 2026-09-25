import { Allow, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Canonical UI file-object contract shared by all XVI-FC State-form file fields
 * (SFC Status, Devolution Formula, Elected Urban Local Bodies).
 *
 * `createdAt`/`updatedAt` are backend-owned (Mongoose-managed timestamps on the
 * FileInfo schema). The UI may still echo either back from a previous GET response,
 * so both must be whitelist-accepted (via @Allow()) without validation — never
 * trusted, persisted, or compared. See FileInfoNormalizerService for where they're
 * dropped.
 */
export class XviFcFileRefDto {
  @IsString()
  @IsNotEmpty()
  originalName!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsNumber()
  @Min(0)
  sizeKb!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageCount?: number | null;

  @Allow()
  @IsOptional()
  createdAt?: unknown;

  @Allow()
  @IsOptional()
  updatedAt?: unknown;
}

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AcknowledgeFormDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

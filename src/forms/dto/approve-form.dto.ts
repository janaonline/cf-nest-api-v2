import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveFormDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

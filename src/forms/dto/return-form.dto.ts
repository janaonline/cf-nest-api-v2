import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReturnFormDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  remarks!: string;
}

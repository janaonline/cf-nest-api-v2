import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitClaimLetterDto {
  // The final PDF the State reviewed (GET :claimLetterId/final-pdf `sourceKey`); stale -> 409.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  finalPdfSourceKey!: string;
}

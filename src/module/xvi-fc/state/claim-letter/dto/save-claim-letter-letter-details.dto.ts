import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class SaveClaimLetterLetterDetailsDto {
  @ApiProperty({ description: 'Changed letter-detail values, keyed by formjson question key (null removes one)' })
  @IsObject()
  data!: Record<string, unknown>;

  // Required as true when the change would remove an uploaded signed letter.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  confirmSignedFileRemoval?: boolean;
}

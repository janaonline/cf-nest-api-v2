import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';

/** Same values as the UI's `PmuReviewFormId`, so the frontend can send its form id as-is. */
export const PMU_UNDO_FORM_TYPES = ['SFC_STATUS', 'GTC', 'DEVOLUTION_FORMULA', 'ELECTED_BODY', 'FC_UNSPENT'] as const;
export type PmuUndoFormType = (typeof PMU_UNDO_FORM_TYPES)[number];

export class PmuUndoDto {
  @ApiProperty({ enum: PMU_UNDO_FORM_TYPES, description: 'Which State form to undo the PMU decision on.' })
  @IsIn(PMU_UNDO_FORM_TYPES)
  type!: PmuUndoFormType;

  @ApiProperty({ description: 'MongoDB ObjectId of the State.' })
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @ApiProperty({ description: 'MongoDB ObjectId of the design year.' })
  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @ApiPropertyOptional({ enum: [1, 2], description: 'Required for GTC and DEVOLUTION_FORMULA; ignored otherwise.' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  installment?: 1 | 2;
}

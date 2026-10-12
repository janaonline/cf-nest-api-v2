import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Shared by every PMU review controller's reject-form endpoint. */
export class RejectPmuFormDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000, { message: 'Remarks must not exceed 1000 characters.' })
  pmuRemarks!: string;
}

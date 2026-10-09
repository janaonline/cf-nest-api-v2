import { IsNotEmpty, IsString } from 'class-validator';

/** Shared by every PMU review controller's reject-form endpoint. */
export class RejectPmuFormDto {
  @IsString()
  @IsNotEmpty()
  pmuRemarks!: string;
}

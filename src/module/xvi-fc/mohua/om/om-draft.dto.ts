import { IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { OM_NUMBER_MAX_LENGTH } from './om.constants';

/** Autosave of the OM's inline boxes; a field left out keeps its value, `null` clears it. */
export class SaveOmDraftDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(OM_NUMBER_MAX_LENGTH)
  omNumber?: string | null;

  /** An ISO date (the portal's date box sends yyyy-mm-ddT00:00:00.000Z); stored as yyyy-mm-dd. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  omDate?: string | null;
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import {
  STATE_FORM_HISTORY_CURSOR_PATTERN,
  STATE_FORM_HISTORY_INSTALLMENTS,
  STATE_FORM_HISTORY_MAX_PAGE_SIZE,
} from '../state-form-history.constants';

export class GetStateFormHistoryQueryDto {
  /** Only meaningful (and required) for installment-scoped forms (GTC, Devolution Formula); ignored otherwise. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(STATE_FORM_HISTORY_INSTALLMENTS)
  installment?: number;

  /** Page size; defaults to 20 and is hard-capped at 50 — larger values are rejected with a 400. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STATE_FORM_HISTORY_MAX_PAGE_SIZE)
  limit?: number;

  /** `nextCursor` from the previous page — returns the entries older than it. */
  @IsOptional()
  @IsString()
  @Matches(STATE_FORM_HISTORY_CURSOR_PATTERN, { message: 'cursor is invalid.' })
  cursor?: string;
}

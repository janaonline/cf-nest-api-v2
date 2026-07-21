import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Note is required (non-empty, max 2000 chars) when returning, optional when approving —
 * the rule shared by every XVI-FC decision DTO (section, document, bank account, and their
 * bulk variants). `entityLabel` only changes the validation error message, e.g. "a section".
 */
export function RequiredNoteWhenReturned(entityLabel: string): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol) {
    ValidateIf((dto: { decision?: string }) => dto.decision === 'RETURNED')(target, propertyKey);
    IsString()(target, propertyKey);
    MinLength(1, { message: `A note is required when returning ${entityLabel} for correction.` })(target, propertyKey);
    MaxLength(2000)(target, propertyKey);
  };
}

/** Shared validation for a bulk decision's target-record id list — 1 to 500 Mongo ids. */
export function BulkIdsList(): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol) {
    IsArray()(target, propertyKey);
    ArrayMinSize(1)(target, propertyKey);
    ArrayMaxSize(500)(target, propertyKey);
    IsMongoId({ each: true })(target, propertyKey);
  };
}

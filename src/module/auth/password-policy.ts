import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * The one password rule for every password the API accepts (register, forgot-password reset, set new password).
 * The UI's `passwordComplexity` validator (cityfinance-ng-ui-v2, auth/validators/auth-security.validators.ts) checks
 * the same things, so a password the form accepts is never refused here. Change both together.
 *
 * 8–72 characters with a lowercase letter, an uppercase letter, a digit and a special character: any character that
 * is not a letter, digit or whitespace in any script (so `é` is a letter, not a symbol). Line breaks are allowed.
 *
 * The cap is 72 UTF-8 bytes, not just 72 characters: bcrypt hashes only the first 72 bytes, so anything after them
 * would be silently ignored at sign-in. A password of plain ASCII hits both limits together.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_PATTERN = /^(?=[\s\S]*[a-z])(?=[\s\S]*[A-Z])(?=[\s\S]*\d)(?=[\s\S]*[^\p{L}\p{N}\s])/u;
export const PASSWORD_RULE_MESSAGE =
  'Password must be 8–72 characters with an uppercase letter, a lowercase letter, a number and a special character';

/** The rule as one property decorator: validation plus the OpenAPI schema, from the same constants. */
export function IsPolicyPassword(description = 'Must contain uppercase, lowercase, number and special character') {
  return applyDecorators(
    ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_BYTES, description }),
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE }),
    MaxLength(PASSWORD_MAX_BYTES, { message: PASSWORD_RULE_MESSAGE }),
    IsByteLength(0, PASSWORD_MAX_BYTES, { message: PASSWORD_RULE_MESSAGE }),
    Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE }),
  );
}

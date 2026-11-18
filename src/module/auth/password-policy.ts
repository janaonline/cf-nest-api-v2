/**
 * The one password rule for every password the API accepts (register, forgot-password reset, set new password).
 * The UI's `passwordComplexity` validator (cityfinance-ng-ui-v2, auth/validators/auth-security.validators.ts) checks
 * the same four things, so a password the form accepts is never refused here. Change both together.
 *
 * 8–128 characters with a lowercase letter, an uppercase letter, a digit and a special character (any symbol that is
 * not a letter, digit or space).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be 8–128 characters with an uppercase letter, a lowercase letter, a number and a special character';

import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsOtp(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isOtp',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          const digits = parseInt(process.env['OTP_DIGITS'] ?? '4', 10);
          return typeof value === 'string' && new RegExp(`^\\d{${digits}}$`).test(value);
        },
        defaultMessage() {
          const digits = parseInt(process.env['OTP_DIGITS'] ?? '4', 10);
          return `OTP must be exactly ${digits} digits`;
        },
      },
    });
  };
}

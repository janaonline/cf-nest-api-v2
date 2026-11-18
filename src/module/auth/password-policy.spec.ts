import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';
import { PASSWORD_PATTERN, PASSWORD_RULE_MESSAGE } from './password-policy';

describe('password policy', () => {
  it.each(['Password#1', 'Abcdef1@', 'Pass word_9'])('accepts %s', (password) => {
    expect(PASSWORD_PATTERN.test(password)).toBe(true);
  });

  it.each([
    ['WELCOME@', 'no lowercase or digit'],
    ['password1!', 'no uppercase'],
    ['Passw0rd', 'no special character'],
    ['Password 1', 'a space is not a special character'],
  ])('rejects %s (%s)', (password) => {
    expect(PASSWORD_PATTERN.test(password)).toBe(false);
  });

  const resetErrors = async (newPassword: string) => {
    const dto = plainToInstance(ResetPasswordDto, {
      identifier: 'user@example.com',
      otp: '1234',
      newPassword,
      confirmPassword: newPassword,
    });
    return (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}));
  };

  it('lets the reset through with a password the UI form also accepts (# was refused before)', async () => {
    expect(await resetErrors('Password#1')).toEqual([]);
  });

  it('refuses a weak, too short or too long reset password with the one rule message', async () => {
    expect(await resetErrors('WELCOME@')).toContain(PASSWORD_RULE_MESSAGE);
    expect(await resetErrors('Ab1!')).toContain(PASSWORD_RULE_MESSAGE);
    expect(await resetErrors(`Aa1!${'x'.repeat(125)}`)).toContain(PASSWORD_RULE_MESSAGE);
  });

  it('uses the same rule for setting a new password', async () => {
    const dto = plainToInstance(SetNewPasswordDto, { newPassword: 'Password#1', saveToken: 't' });
    expect(await validate(dto)).toEqual([]);
    const weak = plainToInstance(SetNewPasswordDto, { newPassword: 'password', saveToken: 't' });
    expect((await validate(weak)).flatMap((e) => Object.values(e.constraints ?? {}))).toContain(PASSWORD_RULE_MESSAGE);
  });
});

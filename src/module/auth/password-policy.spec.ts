import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';
import { PASSWORD_PATTERN, PASSWORD_RULE_MESSAGE } from './password-policy';

describe('password policy', () => {
  it.each(['Password#1', 'Abcdef1@', 'Pass word_9', 'Aa1@xx\nxx'])('accepts %j', (password) => {
    expect(PASSWORD_PATTERN.test(password)).toBe(true);
  });

  it.each([
    ['WELCOME@', 'no lowercase or digit'],
    ['password1!', 'no uppercase'],
    ['Passw0rd', 'no special character'],
    ['Password 1', 'a space is not a special character'],
    ['Aa1aaaaé', 'a letter in another script is not a special character'],
  ])('rejects %j (%s)', (password) => {
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

  it('refuses a weak or too short reset password with the one rule message', async () => {
    expect(await resetErrors('WELCOME@')).toContain(PASSWORD_RULE_MESSAGE);
    expect(await resetErrors('Ab1!')).toContain(PASSWORD_RULE_MESSAGE);
  });

  it('caps the password at the 72 bytes bcrypt hashes, counting UTF-8 bytes, not characters', async () => {
    const ascii = (n: number) => `Aa1!${'x'.repeat(n - 4)}`;
    expect(await resetErrors(ascii(72))).toEqual([]);
    expect(await resetErrors(ascii(73))).toContain(PASSWORD_RULE_MESSAGE);
    // 40 characters, but each "é" is 2 bytes: 4 + 36 × 2 = 76 bytes.
    expect(await resetErrors(`Aa1!${'é'.repeat(36)}`)).toContain(PASSWORD_RULE_MESSAGE);
  });

  it('uses the same rule for registering and for setting a new password', async () => {
    const weak = 'password';
    const register = plainToInstance(RegisterDto, {
      name: 'A',
      email: 'a@b.co',
      password: weak,
      confirmPassword: weak,
    });
    const setNew = plainToInstance(SetNewPasswordDto, { newPassword: weak, saveToken: 't' });
    for (const dto of [register, setNew]) {
      expect((await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}))).toContain(PASSWORD_RULE_MESSAGE);
    }
    expect(await validate(plainToInstance(SetNewPasswordDto, { newPassword: 'Password#1', saveToken: 't' }))).toEqual(
      [],
    );
  });
});

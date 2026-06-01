import { ConfigService } from '@nestjs/config';

export interface OtpConfig {
  /** Number of digits in the OTP (env: OTP_LENGTH, fallback OTP_DIGITS, default 6). */
  length: number;
  /** How long the OTP is valid in seconds (env: OTP_TTL_SECONDS, default 300). */
  ttlSeconds: number;
  /** Minimum gap between resend requests in seconds (env: OTP_RESEND_COOLDOWN_SECONDS, default 30). */
  resendCooldownSeconds: number;
  /** Max wrong-OTP attempts before a lockout (env: OTP_MAX_VERIFY_ATTEMPTS, default 5). */
  maxVerifyAttempts: number;
  /** Max times a new OTP can be sent within a single OTP window (env: OTP_MAX_RESEND_ATTEMPTS, default 3). */
  maxResendAttempts: number;
  /** How long the lockout lasts in seconds (env: OTP_LOCK_SECONDS, default 900). */
  lockSeconds: number;
  isProduction: boolean;
}

export function getOtpConfig(config: ConfigService): OtpConfig {
  const n = (key: string, fallback: number): number => {
    const raw = config.get<string>(key);
    const parsed = parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  // Support legacy OTP_DIGITS env alongside new OTP_LENGTH
  const length = n('OTP_LENGTH', 0) || n('OTP_DIGITS', 4);

  return {
    length,
    ttlSeconds: n('OTP_TTL_SECONDS', 300),
    resendCooldownSeconds: n('OTP_RESEND_COOLDOWN_SECONDS', 30),
    maxVerifyAttempts: n('OTP_MAX_VERIFY_ATTEMPTS', 5),
    maxResendAttempts: n('OTP_MAX_RESEND_ATTEMPTS', 3),
    lockSeconds: n('OTP_LOCK_SECONDS', 900),
    isProduction: config.get<string>('NODE_ENV') === 'production',
  };
}

/**
 * Generates a cryptographically secure numeric OTP.
 * In non-production environments the OTP is a deterministic string ('111111' etc.)
 * so that engineers can test without SMS/email delivery.
 */
export function generateOtp(length: number, isProduction: boolean): string {
  if (!isProduction) return '1'.repeat(length);
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  // crypto.randomInt is available in Node ≥ 14.10
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomInt } = require('crypto') as { randomInt: (min: number, max: number) => number };
  return randomInt(min, max + 1).toString().padStart(length, '0');
}

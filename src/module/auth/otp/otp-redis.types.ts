export interface OtpState {
  hashedOtp: string;
  purpose: string;
  identifier: string;
  createdAt: string;   // ISO string
  expiresAt: string;   // ISO string — used to recalculate remaining TTL on update
  resendCount: number;
  verifyAttempts: number;
}

/**
 * Normalises the raw identifier so Redis keys are stable regardless of case.
 * Emails are lowercased; census/SB codes are left as-is since they're case-sensitive
 * on the DB side.
 */
export function normalizeIdentifier(raw: string): string {
  const s = raw.trim();
  return s.includes('@') ? s.toLowerCase() : s;
}

// ─── Key builders ────────────────────────────────────────────────────────────

/** Primary OTP state: hashed OTP + attempt counters. TTL = OTP_TTL_SECONDS. */
export function otpStateKey(purpose: string, identifier: string): string {
  return `otp:state:${purpose}:${identifier}`;
}

/** Resend cooldown gate. TTL = OTP_RESEND_COOLDOWN_SECONDS. */
export function otpCooldownKey(purpose: string, identifier: string): string {
  return `otp:cooldown:${purpose}:${identifier}`;
}

/**
 * Temporary lockout after exhausting verify attempts.
 * TTL = OTP_LOCK_SECONDS.
 */
export function otpLockKey(purpose: string, identifier: string): string {
  return `otp:lock:${purpose}:${identifier}`;
}

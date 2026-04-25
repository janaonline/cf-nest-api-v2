/**
 * OTP API contracts — payload and response types for UI integration.
 *
 * This file has zero runtime dependencies and can be copied as-is into any
 * frontend TypeScript project (React, Angular, Vue, plain TS).
 *
 * Endpoints
 * ---------
 *   POST /auth/sendOtp
 *   POST /auth/verifyOtp
 */

// ─── Shared ───────────────────────────────────────────────────────────────────

export type OtpPurpose = 'login' | 'forgot-password';

// ─── POST /auth/sendOtp ───────────────────────────────────────────────────────

/**
 * Request body for POST /auth/sendOtp
 */
export interface SendOtpPayload {
  /**
   * The account identifier — one of:
   *   • email address  (e.g. "admin@cityfinance.in")
   *   • Census code    (e.g. "800011")
   *   • SB code        (e.g. "SB0001")
   *
   * Emails are automatically lowercased; census/SB codes are sent as-is.
   */
  identifier: string;

  /**
   * Optional — defaults to "login".
   * Use "forgot-password" to initiate the password-reset flow.
   */
  purpose?: OtpPurpose;
}

/**
 * Success response for POST /auth/sendOtp (HTTP 200)
 *
 * The server always returns success=true even when the account does not
 * exist, to prevent account-enumeration attacks.
 */
export interface SendOtpResponse {
  success: true;
  message: string;

  /**
   * Masked mobile number, e.g. "98******10".
   * Present only when the account has a registered mobile.
   */
  mobile?: string;

  /**
   * Masked email address, e.g. "ad***@cityfinance.in".
   * Present only when the account has a registered email.
   */
  email?: string;
}

// ─── POST /auth/verifyOtp ─────────────────────────────────────────────────────

/**
 * Request body for POST /auth/verifyOtp
 */
export interface VerifyOtpPayload {
  /**
   * The same identifier used in sendOtp.
   */
  identifier: string;

  /**
   * The numeric OTP entered by the user (e.g. "123456").
   * Length is determined by OTP_LENGTH env on the server (default 6).
   */
  otp: string;
}

// ─── User shape returned after successful OTP verification ────────────────────

export type UserRole =
  | 'ADMIN'
  | 'MoHUA'
  | 'PARTNER'
  | 'STATE'
  | 'ULB'
  | 'USER'
  | 'XVIFC_STATE'
  | 'STATE_DASHBOARD'
  | 'AFS_ADMIN'
  | 'XVIFC'
  | 'PMU'
  | 'AAINA';

export type UserStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NA';

/**
 * Safe user object — all sensitive fields (password, tokens, OTP state) are
 * stripped server-side before this is returned.
 */
export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  username: string;
  sbCode: string | null;
  censusCode: string | null;
  designation: string;
  organization: string;

  /** MongoDB ObjectId string of the linked State document. */
  state: string | null;
  /** MongoDB ObjectId string of the linked ULB document. */
  ulb: string | null;
  /** MongoDB ObjectId string of the user who created this account. */
  createdBy: string | null;

  departmentName: string;
  departmentContactNumber: string;
  departmentEmail: string;
  address: string;

  commissionerName: string;
  commissionerEmail: string;
  commissionerConatactNumber: string;

  accountantName: string;
  accountantEmail: string;
  accountantConatactNumber: string;

  status: UserStatus;
  rejectReason: string;

  isActive: boolean;
  isEmailVerified: boolean;
  isDeleted: boolean;
  isRegistered: boolean;
  isVerified2223: boolean;
  isNodalOfficer: boolean;

  /** ISO date string or null. */
  lastLoginAt: string | null;
  /** ISO date string — set by Mongoose timestamps. */
  createdAt: string;
  /** ISO date string — set by Mongoose timestamps. */
  updatedAt: string;
}

/**
 * Success response for POST /auth/verifyOtp (HTTP 200)
 *
 * The access token should be sent as a Bearer token in the Authorization
 * header for all subsequent authenticated requests.
 *
 * The refresh token is set as an httpOnly cookie by the server automatically.
 * You do not need to handle it manually in most browser environments.
 */
export interface VerifyOtpResponse {
  /** Short-lived JWT access token. Include as: Authorization: Bearer <token> */
  token: string;
  user: AuthUser;
  /** Present only for certain admin roles that need cross-year data. */
  allYears?: Record<string, unknown>;
}

// ─── POST /auth/forgot-password/reset ────────────────────────────────────────

/**
 * Request body for POST /auth/forgot-password/reset
 *
 * Send the OTP received from POST /auth/sendOtp (purpose: "forgot-password")
 * together with the new password in a single request.
 */
export interface ResetPasswordPayload {
  /** The same identifier used in sendOtp. */
  identifier: string;
  /** The numeric OTP received via SMS / email. */
  otp: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Success response for POST /auth/forgot-password/reset (HTTP 200)
 */
export interface ResetPasswordResponse {
  message: string;
}

// ─── Error response shape ─────────────────────────────────────────────────────

/**
 * Shape of all error responses from the API (produced by HttpExceptionFilter).
 */
export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  /** ISO timestamp of when the error occurred. */
  timestamp: string;
  /** Request path, e.g. "/auth/sendOtp". */
  path: string;
  /** Field-level validation errors — present only on 400 validation failures. */
  errors?: Record<string, string[]>;
}

// ─── Known error codes ────────────────────────────────────────────────────────

/**
 * HTTP status codes the OTP endpoints can return, and what they mean.
 *
 * Usage example:
 *   if (error.statusCode === OtpErrorCode.RATE_LIMITED) { ... }
 */
export const OtpErrorCode = {
  /** Validation failed — check `errors` field in ApiErrorResponse. */
  INVALID_INPUT: 400,
  /** OTP is wrong or has expired. */
  INVALID_OR_EXPIRED: 422,
  /** Rate-limited: cooldown active, too many attempts, or account locked. */
  RATE_LIMITED: 429,
  /** Internal server error. */
  SERVER_ERROR: 500,
} as const;

export type OtpErrorCode = (typeof OtpErrorCode)[keyof typeof OtpErrorCode];

// ─── Known error messages (for UI copy matching) ─────────────────────────────

/**
 * Stable error message strings returned by the server.
 * Match against `ApiErrorResponse.message` to show localised UI copy.
 */
export const OtpErrorMessage = {
  PLEASE_WAIT: 'Please wait before requesting another OTP.',
  MAX_RESEND: 'Maximum OTP requests reached. Please try again later.',
  LOCKED: 'Too many attempts. Please try again later.',
  TOO_MANY_VERIFY: 'Too many attempts. Please request a new OTP.',
  INVALID_OR_EXPIRED: 'Invalid or expired OTP',
} as const;

import { ConfigService } from '@nestjs/config';

const DEFAULT_CLIENT_URL = 'https://cityfinance.in';

/** Login-flow `type` shared by every ULB/STATE/MoHUA invite and onboarding email — all of this
 *  portal's account-provisioning flows are XVI-FC ones. Kept in one place instead of the literal
 *  `'XVIFC'` being retyped at each call site. */
export const PORTAL_INVITE_LOGIN_TYPE = '16thFC';

/** Resolves the frontend's base URL, consistently defaulting when `CLIENT_URL` is unset. */
export function resolveClientBaseUrl(configService: ConfigService): string {
  return configService.get<string>('CLIENT_URL', DEFAULT_CLIENT_URL);
}

export const APP_URL = {
  UI_V1: 'v1',
  UI_V2: 'fc',
  UI_SSR_V3: '',
  API_V3: 'api/v3',
};

const baseUrl = '';
export const AUTH_URL = {
  LOGIN: `auth/login`,
  RESET_PASSWORD: 'auth/forgot-password',
};

/**
 * Builds the login and password-reset URLs emailed to a newly-provisioned or invited portal
 * account. When given, `type` is appended as a path segment (`login/:type`,
 * `forgot-password/:type` in `auth.routes.ts` on the frontend); callers that don't know/need a
 * type get the bare `login`/`forgot-password` routes instead.
 */
export function buildPortalAuthUrls(
  configService: ConfigService,
  type?: string,
): { loginUrl: string; resetPasswordUrl: string } {
  const baseUrl = resolveClientBaseUrl(configService);
  const suffix = type ? `/${type}` : '';
  return {
    loginUrl: `${baseUrl}/fc/auth/login${suffix}`,
    resetPasswordUrl: `${baseUrl}/fc/auth/forgot-password${suffix}`,
  };
}

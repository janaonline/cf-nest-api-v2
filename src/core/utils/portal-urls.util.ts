import { ConfigService } from '@nestjs/config';

// Last-resort default when neither CLIENT_URL nor BASE_URL is configured.
const DEFAULT_CLIENT_URL = 'https://www.cityfinance.in';

/** Login-flow `type` shared by every ULB/STATE/MoHUA invite and onboarding email — all of this
 *  portal's account-provisioning flows are XVI-FC ones. Kept in one place instead of the literal
 *  `'XVIFC'` being retyped at each call site. */
export const PORTAL_INVITE_LOGIN_TYPE = '16thFC';

/**
 * Resolves the frontend's base URL. Prefers an explicit `CLIENT_URL`; otherwise derives the
 * hostname from this API's own `BASE_URL` (e.g. `BASE_URL=https://www.cityfinance.in/api/v2/` ->
 * `https://www.cityfinance.in`), the same pattern `AnnualAccountOcrApiService` uses for the OCR
 * API host — so a dev/staging deployment links back to its own frontend instead of the hardcoded
 * prod default. This is config-only (no Request involved), so it resolves identically from
 * controllers, queue processors, and `@Cron` jobs alike.
 */
export function resolveClientBaseUrl(configService: ConfigService): string {
  const clientUrl = configService.get<string>('CLIENT_URL');
  if (clientUrl) return clientUrl;

  const baseUrl = configService.get<string>('BASE_URL', '');
  return baseUrl ? new URL(baseUrl).origin : DEFAULT_CLIENT_URL;
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
  const suffix = type ? `/${type}` : '';
  return {
    loginUrl: getPortalUrl(configService, `auth/login${suffix}`),
    resetPasswordUrl: getPortalUrl(configService, `auth/forgot-password${suffix}`),
  };
}

// Builds the full URL for a given path within the portal.
// eg: getPortalUrl(configService, 'auth/login') => 'https://www.cityfinance.in/fc/auth/login'
export function getPortalUrl(configService: ConfigService, path: string): string {
  const baseUrl = resolveClientBaseUrl(configService);
  return `${baseUrl}/fc/${path}`;
}

import type { Request } from 'express';

/** Pulls the caller's real IP (behind a proxy) and user agent, for audit/decision records. */
export function extractIpAndUserAgent(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;
  const userAgent = (req.headers['user-agent'] as string) ?? null;
  return { ipAddress, userAgent };
}

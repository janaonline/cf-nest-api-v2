import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth-user.interface';
import { Scope } from '../enum/roles-xvi-fc.enum';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface AllowedWrite {
  method: string;
  /** Matched against the request path with the `/api/vN` prefix and any trailing slash removed. */
  path: RegExp;
  /** Capture group 1 is a user id, and it must be the caller's own — own-profile endpoints only. */
  selfOnly?: boolean;
}

const SEGMENT = '[^/]+';

/**
 * The only non-GET requests a DoE user may make: its own session and profile, its own notifications, and DoE
 * team management (the service behind those routes still checks the caller is the DoE Submitter).
 * Everything else — every form, upload, review, claim and file write — is denied.
 */
const ALLOWED_WRITES: readonly AllowedWrite[] = [
  { method: 'POST', path: /^\/auth\/logout$/ },
  { method: 'PATCH', path: /^\/auth\/set-new-password$/ },
  { method: 'POST', path: /^\/email\/(sendProfileOtp|verifyProfileOtp|checkEmailDomain)$/ },
  { method: 'POST', path: new RegExp(`^/users/(${SEGMENT})/issue-profile-save-token$`), selfOnly: true },
  { method: 'PATCH', path: new RegExp(`^/users/(${SEGMENT})/profile-contacts$`), selfOnly: true },
  { method: 'PATCH', path: new RegExp(`^/notifications/(read-all|${SEGMENT}/read)$`) },
  { method: 'POST', path: /^\/users\/invite-doe-member$/ },
  { method: 'POST', path: /^\/users\/doe-members\/transfer-submitter$/ },
  { method: 'PATCH', path: new RegExp(`^/users/doe-members/${SEGMENT}/sub-role$`) },
  { method: 'DELETE', path: new RegExp(`^/users/doe-members/${SEGMENT}$`) },
];

/**
 * DoE is a read-only copy of the MoHUA dashboard. Rather than trusting every one of the API's write
 * endpoints to refuse an unfamiliar scope, this single global guard rejects any write from a DoE user that
 * is not on the allowlist above — including endpoints with no role or permission check of their own
 * (for example `POST file/signed-url`, which hands out S3 upload URLs).
 *
 * Registered right after JwtAuthGuard (see AuthModule) so `request.user` is already set; public routes
 * skip JwtAuthGuard, leave `request.user` unset and pass straight through.
 */
@Injectable()
export class DoeReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;

    if (user?.scope !== Scope.DOE) return true;
    if (SAFE_METHODS.has(request.method)) return true;

    const path = request.path.replace(/^\/api\/v\d+/, '').replace(/\/+$/, '');
    const allowed = ALLOWED_WRITES.some((rule) => {
      if (rule.method !== request.method) return false;
      const match = rule.path.exec(path);
      if (!match) return false;
      return !rule.selfOnly || match[1] === String(user._id);
    });

    if (!allowed) {
      throw new ForbiddenException('This account has read-only access.');
    }
    return true;
  }
}

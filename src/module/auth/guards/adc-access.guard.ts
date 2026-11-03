import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth-user.interface';
import { isAdcUser } from '../roles-xvi-fc.helper';

interface AllowedRoute {
  method: string;
  /** Matched against the request path with the `/api/vN` prefix and any trailing slash removed. */
  path: RegExp;
  /** Capture group 1 is a user id, and it must be the caller's own — own-profile endpoints only. */
  selfOnly?: boolean;
}

const ID = '[^/]+';
const FORM = '(annual-account|bank-account|dur)';

/**
 * Every route an ADC user may call — reads included. An ADC user is a STATE-role user, so most State routes
 * would accept them; the permission table (XVIFC_ADC_PERMISSIONS) already denies those that need a State-form
 * permission, and this allowlist covers the rest (State dashboard/overview, side-menu CRUD, `users/*`, ...).
 * A route an ADC page needs has to be added here.
 */
const ALLOWED_ROUTES: readonly AllowedRoute[] = [
  // Session, profile, notifications
  { method: 'GET', path: /^\/auth\/me$/ },
  { method: 'POST', path: /^\/auth\/logout$/ },
  { method: 'PATCH', path: /^\/auth\/set-new-password$/ },
  { method: 'POST', path: /^\/email\/(sendProfileOtp|verifyProfileOtp|checkEmailDomain)$/ },
  { method: 'POST', path: new RegExp(`^/users/(${ID})/issue-profile-save-token$`), selfOnly: true },
  { method: 'GET', path: new RegExp(`^/users/(${ID})/profile-contacts$`), selfOnly: true },
  { method: 'PATCH', path: new RegExp(`^/users/(${ID})/profile-contacts$`), selfOnly: true },
  { method: 'GET', path: /^\/notifications(\/unread-count)?$/ },
  { method: 'PATCH', path: new RegExp(`^/notifications/(read-all|${ID}/read)$`) },

  // Shell: sidebar, design years, support hours
  { method: 'GET', path: new RegExp(`^/xvi-fc/sidebar/${ID}$`) },
  { method: 'GET', path: /^\/xvi-fc\/years$/ },
  { method: 'GET', path: /^\/xvi-fc\/support-hours$/ },

  // ULB Forms Review — lists
  { method: 'GET', path: new RegExp(`^/xvi-fc/${FORM}/state/ulb-submissions$`) },
  { method: 'GET', path: /^\/xvi-fc\/ulb\/slb\/state\/ulb-submissions$/ },
  { method: 'GET', path: /^\/xvi-fc\/state\/ulb-submissions\/export$/ },

  // ULB Forms Review — the review page
  { method: 'GET', path: new RegExp(`^/xvi-fc/(annual-account|dur)/by-ulb/${ID}/${ID}$`) },
  { method: 'GET', path: /^\/xvi-fc\/annual-account\/upload-config\/(audited|provisional)$/ },
  { method: 'GET', path: /^\/xvi-fc\/bank-account$/ },
  { method: 'GET', path: new RegExp(`^/xvi-fc/ulb/slb/${ID}/${ID}$`) },
  { method: 'GET', path: new RegExp(`^/xvi-fc/${FORM}/${ID}/logs$`) },

  // ULB Forms Review — decisions
  { method: 'POST', path: new RegExp(`^/xvi-fc/${FORM}/${ID}/(decision|undo-approval)$`) },
  { method: 'POST', path: new RegExp(`^/xvi-fc/annual-account/${ID}/documents/${ID}/decision$`) },
  { method: 'DELETE', path: new RegExp(`^/xvi-fc/annual-account/${ID}/documents/${ID}/decision$`) },
  { method: 'POST', path: new RegExp(`^/xvi-fc/${FORM}/bulk-decision$`) },

  // Register / list / edit ULB
  { method: 'GET', path: /^\/master\/ulb$/ },
  { method: 'GET', path: /^\/master\/ulb\/(register-sections|types)$/ },
  { method: 'POST', path: /^\/master\/ulb$/ },
  { method: 'PATCH', path: new RegExp(`^/master/ulb/${ID}$`) },
  { method: 'POST', path: /^\/file\/signed-url$/ },

  // ADC team (People and Roles)
  { method: 'GET', path: /^\/users\/adc-(members|permission-matrix)$/ },
  { method: 'POST', path: /^\/users\/invite-adc-member$/ },
  { method: 'POST', path: /^\/users\/adc-members\/transfer-submitter$/ },
  { method: 'PATCH', path: new RegExp(`^/users/adc-members/${ID}/sub-role$`) },
  { method: 'DELETE', path: new RegExp(`^/users/adc-members/${ID}$`) },
];

/**
 * ADC users (STATE role with `adc` set) may only reach the allowlisted routes above — a single deny-by-default
 * choke point instead of trusting every State endpoint to refuse an ADC user. Routes whose service checks the
 * ULB's owner (review lists/decisions, ULB create/edit) still enforce ownership themselves.
 *
 * Registered after JwtAuthGuard and DoeReadOnlyGuard (see AuthModule); public routes leave `request.user`
 * unset and pass straight through.
 */
@Injectable()
export class AdcAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;

    if (!user || !isAdcUser(user)) return true;

    const path = request.path.replace(/^\/api\/v\d+/, '').replace(/\/+$/, '');
    const allowed = ALLOWED_ROUTES.some((rule) => {
      if (rule.method !== request.method) return false;
      const match = rule.path.exec(path);
      if (!match) return false;
      return !rule.selfOnly || match[1] === String(user._id);
    });

    if (!allowed) {
      throw new ForbiddenException('This page is not available for ADC users.');
    }
    return true;
  }
}

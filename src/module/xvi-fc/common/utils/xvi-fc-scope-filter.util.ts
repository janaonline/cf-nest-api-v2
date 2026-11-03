import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { isAdcUser } from 'src/module/auth/roles-xvi-fc.helper';

/**
 * Resolves the state filter for a "list ULB submissions" query, shared across every
 * XVI-FC form: STATE users are always scoped to their own state; ADMIN may optionally
 * pass one, else sees all.
 */
export function resolveStateScopeFilter(user: AuthUser, queryStateId?: string): Types.ObjectId | null {
  if (user.scope === Scope.STATE) {
    if (!user.state) throw new ForbiddenException('No state associated with this user');
    return new Types.ObjectId(user.state as string);
  }
  return queryStateId ? new Types.ObjectId(queryStateId) : null;
}

/**
 * The ADC filter to add to a "list ULB submissions" `$match` next to `resolveStateScopeFilter`: an ADC user sees
 * only their own ADC's ULBs; everyone else (State, ADMIN) gets `null` — no ADC restriction.
 */
export function resolveAdcScopeFilter(user: AuthUser): Types.ObjectId | null {
  return isAdcUser(user) ? new Types.ObjectId(String(user.adc)) : null;
}

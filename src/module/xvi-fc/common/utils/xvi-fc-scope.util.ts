import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';

/**
 * MoHUA and DoE both see the national, read-only dashboard: every state, every ULB, every form. DoE is a
 * read-only copy of MoHUA, so every MoHUA *read* path accepts both scopes through this one check.
 *
 * Use it only where MoHUA merely views (including the guards that stop a view from creating or deleting an
 * exemption stub). Anything that decides, approves or edits keeps its explicit `Scope.MOHUA` check — DoE
 * must never reach it.
 */
export function isMohuaViewScope(user: Pick<AuthUser, 'scope'>): boolean {
  return user.scope === Scope.MOHUA || user.scope === Scope.DOE;
}

/**
 * Who may read the national dashboard: MoHUA and DoE, plus PMU, whose Overview is the same dashboard. Used by
 * the three `mohua/overview` controllers and by every ULB form read that dashboard's ULB page makes (Annual
 * Accounts, Bank Account, SLB, DUR) — there it also keeps those viewers from writing exemption stubs. Other
 * MoHUA reads keep `isMohuaViewScope`, as the dashboard doesn't need them.
 */
export function isNationalDashboardScope(user: Pick<AuthUser, 'scope'>): boolean {
  return isMohuaViewScope(user) || user.scope === Scope.PMU;
}

/**
 * TS-1305: the name the forum shows for a user — on their posts and in the user menu while on /forum.
 * ULB accounts are shared by all staff at a ULB and may carry a person's name, so the forum shows whose
 * position a post is (the ULB, the State DMA, MoHUA) rather than the account name.
 *
 * Single source of truth: used by ForumService (resolved live whenever posts are shown, and stored on new
 * posts as a fallback) and the auth user payload (`forumDisplayName`).
 */
const ULB_ROLES = new Set(['ULB', 'ULB-EDITOR', 'ULB-VIEWER']);
const STATE_ROLES = new Set(['STATE', 'XVIFC_STATE', 'STATE-EDITOR', 'STATE-VIEWER']);

/** Embedded author names are capped at 60 characters (ForumEmbeddedUser.name). */
export const FORUM_DISPLAY_NAME_MAX = 60;

export interface ForumDisplayNameInput {
  role?: string | null;
  /** The user account's own name (falls back to email, then 'Unknown user'). */
  accountName?: string | null;
  email?: string | null;
  ulbName?: string | null;
  stateName?: string | null;
}

export function resolveForumDisplayName(input: ForumDisplayNameInput): string {
  const role = input.role ?? '';
  const ulbName = input.ulbName?.trim();
  const stateName = input.stateName?.trim();
  let name: string | undefined;
  if (ULB_ROLES.has(role) && ulbName) name = ulbName;
  else if (STATE_ROLES.has(role) && stateName) name = `State DMA, ${stateName}`;
  else if (role === 'MoHUA') name = 'MoHUA';
  name ||= input.accountName?.trim() || input.email?.trim() || 'Unknown user';
  return name.slice(0, FORUM_DISPLAY_NAME_MAX);
}

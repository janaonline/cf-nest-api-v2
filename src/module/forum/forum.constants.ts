/**
 * Canonical forum categories, inserted on app boot when missing (see ForumService.onModuleInit).
 * Existing rows are left alone, so ADMIN edits to their name or description persist.
 */
export const FORUM_CATEGORIES = [
  {
    name: 'MoHUA',
    slug: 'mohua',
    description: 'Official MoHUA guidance, policy clarifications, programme updates, and ministry-level discussions.',
  },
  {
    name: 'State Specific',
    slug: 'state-specific',
    description: 'State-level implementation, finance, governance, and coordination discussions.',
  },
  {
    name: 'ULB Queries',
    slug: 'ulb-queries',
    description: 'Practical questions from ULBs about grants, compliance, reporting, and municipal finance.',
  },
] as const;

export const FORUM_CATEGORY_SLUGS: string[] = FORUM_CATEGORIES.map((c) => c.slug);

/**
 * A valid category slug: 1–60 of a–z, 0–9 and "-". The same rule as category management, where
 * `slugify` can produce a one-character slug (e.g. "a") and slugs longer than 60 are refused.
 */
export const FORUM_CATEGORY_SLUG_PATTERN = /^[a-z0-9-]{1,60}$/;

/**
 * Text limits, measured in UTF-16 code units like the schema's `maxlength`, so an emoji counts as 2
 * here exactly as it does when Mongoose saves it.
 */
export const FORUM_LIMITS = {
  title: { min: 5, max: 140 },
  threadBody: { min: 20, max: 20_000 },
  commentBody: { min: 2, max: 10_000 },
} as const;

/** Max rows returned by the thread list / admin list endpoints. */
export const FORUM_THREAD_LIST_LIMIT = 50;
export const FORUM_ADMIN_LIST_LIMIT = 200;

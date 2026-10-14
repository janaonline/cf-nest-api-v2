/** Canonical forum categories, upserted by slug on every app boot (see ForumService.onModuleInit). */
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

/** Max rows returned by the thread list / admin list endpoints. */
export const FORUM_THREAD_LIST_LIMIT = 50;
export const FORUM_ADMIN_LIST_LIMIT = 200;

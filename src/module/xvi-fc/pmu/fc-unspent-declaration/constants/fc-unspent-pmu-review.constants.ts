/** PMU-only copy of fc-unspent-declaration's pagination bounds — deliberately not shared with
 *  `state/fc-unspent-declaration/constants/fc-unspent-declaration.constants.ts`'s
 *  `FC_UNSPENT_PAGINATION_*`, which the STATE-side ULB-options picker and MoHUA's own row list also
 *  import; changing those would silently tighten both of those unrelated endpoints too. */
export const FC_UNSPENT_PMU_PAGINATION_DEFAULT_PAGE = 1;
export const FC_UNSPENT_PMU_PAGINATION_DEFAULT_LIMIT = 20;
export const FC_UNSPENT_PMU_PAGINATION_MAX_LIMIT = 25;

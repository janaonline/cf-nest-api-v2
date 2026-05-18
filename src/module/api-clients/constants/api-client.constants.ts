export const API_CLIENT_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  REVOKED: 'REVOKED',
} as const;

export const ACTOR_TYPE = {
  STATE: 'STATE',
  ULB: 'ULB',
} as const;

/** Default bcrypt salt rounds for secret hashing. */
export const DEFAULT_SALT_ROUNDS = 12;

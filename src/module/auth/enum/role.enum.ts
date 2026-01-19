export const enum Role {
  ADMIN = 'ADMIN',
  MoHUA = 'MoHUA',
  PARTNER = 'PARTNER',
  STATE = 'STATE',
  ULB = 'ULB',
  USER = 'USER',
  XVIFC_STATE = 'XVIFC_STATE',
  STATE_DASHBOARD = 'STATE_DASHBOARD',
  AFS_ADMIN = 'AFS_ADMIN',
  XVIFC = 'XVIFC',
}

type UserRole =
  | Role.ADMIN
  | Role.MoHUA
  | Role.PARTNER
  | Role.STATE
  | Role.ULB
  | Role.USER
  | Role.XVIFC_STATE
  | Role.STATE_DASHBOARD
  | Role.AFS_ADMIN
  | Role.XVIFC;

export interface User {
  _id: string;
  role: UserRole;
}

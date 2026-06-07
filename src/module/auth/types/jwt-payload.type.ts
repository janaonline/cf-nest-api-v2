export interface JwtPayload {
  sub: string;
  role?: string;
  jti?: string;
  scope?: string;
  accessLevel?: string;
  // email: string;
  // role: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  refreshToken?: string;
}

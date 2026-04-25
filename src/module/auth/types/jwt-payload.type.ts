export interface JwtPayload {
  sub: string;
  // email: string;
  // role: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  refreshToken?: string;
}

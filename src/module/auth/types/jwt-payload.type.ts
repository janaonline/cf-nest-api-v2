export interface JwtPayload {
  _id: string;
  lh_id: string;
  sessionId: string;
  purpose: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  refreshToken?: string;
}

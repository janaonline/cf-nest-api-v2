export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  token: string;
  user: Record<string, unknown>;
  allYears?: Record<string, unknown>;
}

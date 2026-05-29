/** Arbitrary key-value metadata attached to success responses (e.g. pagination counts). */
export type ApiResponseMeta = Record<string, unknown>;

/** Standard envelope for successful API responses. */
export type ApiSuccessResponse<T = unknown> = {
  success: true;
  message: string;
  data: T;
  meta?: ApiResponseMeta;
};

/** Standard envelope for error API responses. */
export type ApiErrorResponse = {
  success: false;
  message: string;
  error: {
    code: string;
    statusCode: number;
    details?: unknown;
  };
};

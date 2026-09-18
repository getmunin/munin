export const RATE_LIMITED_CODE = 'rate_limited';

export interface RateLimitedBody {
  statusCode: 429;
  code: typeof RATE_LIMITED_CODE;
  message: string;
  retryAfterSeconds: number;
}

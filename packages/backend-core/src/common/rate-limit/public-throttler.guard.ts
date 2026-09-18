import { HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Response } from 'express';
import { RATE_LIMITED_CODE, type RateLimitedBody } from '@getmunin/types';

@Injectable()
export class PublicThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<never> {
    const retryAfterSeconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    context
      .switchToHttp()
      .getResponse<Response>()
      .header('Retry-After', String(retryAfterSeconds));
    const body: RateLimitedBody = {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: RATE_LIMITED_CODE,
      retryAfterSeconds,
      message:
        `${RATE_LIMITED_CODE}: exceeded ${detail.limit} requests per ` +
        `${describeWindow(detail.ttl)} on this endpoint. Retry in ${retryAfterSeconds}s.`,
    };
    throw new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function describeWindow(ttlMs: number): string {
  const seconds = Math.max(1, Math.round(ttlMs / 1000));
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return hours === 1 ? 'hour' : `${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? 'minute' : `${minutes} minutes`;
  }
  return seconds === 1 ? 'second' : `${seconds} seconds`;
}

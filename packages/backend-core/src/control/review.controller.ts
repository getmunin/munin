import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { ReviewService, type ReviewItem } from '../modules/review/review.service.ts';
import { decodeCursor, encodeCursor } from '../common/transfer/transfer.helpers.ts';

const LISTABLE_STATES = ['waiting', 'scheduled', 'decided'] as const;

type ListableState = (typeof LISTABLE_STATES)[number];

export interface ReviewListResponse {
  items: ReviewItem[];
  nextCursor: string | null;
}

@Controller('v1/review')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get()
  async list(
    @Query('state') state?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ReviewListResponse> {
    const take = clampLimit(limit, 50, 200);
    const resolved = readState(state);

    if (resolved === 'decided') {
      const decoded = decodeCursor(cursor);
      const page = await this.review.listDecided({
        limit: take,
        ...(decoded ? { cursor: { decidedAt: decoded.createdAt, id: decoded.id } } : {}),
      });
      return {
        items: page.items,
        nextCursor: page.nextCursor
          ? encodeCursor(page.nextCursor.decidedAt, page.nextCursor.id)
          : null,
      };
    }

    const items =
      resolved === 'scheduled'
        ? await this.review.listScheduled(take)
        : await this.review.listWaiting(take);
    return { items, nextCursor: null };
  }
}

function readState(value: string | undefined): ListableState {
  if (value === undefined) return 'waiting';
  if (isListable(value)) return value;
  throw new BadRequestException(
    `review_invalid: state must be one of ${LISTABLE_STATES.join(', ')}`,
  );
}

function isListable(value: string): value is ListableState {
  return (LISTABLE_STATES as readonly string[]).includes(value);
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

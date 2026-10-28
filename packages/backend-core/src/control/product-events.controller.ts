import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { RATE_LIMITED_CODE, type RateLimitedBody } from '@getmunin/types';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import {
  AdmitAdminKeyScope,
  ControlPlaneGuard,
} from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.ts';
import {
  PRODUCT_EVENT_MAX_BATCH,
  PRODUCT_EVENT_NAME_PATTERN,
  ProductEventsService,
  type ProductEventResult,
} from '../modules/analytics/product-events.service.ts';

const ProductEventSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().regex(PRODUCT_EVENT_NAME_PATTERN),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  identity: z.object({
    contactId: z.string().min(1).max(64).optional(),
    externalId: z.string().min(1).max(256).optional(),
    email: z.string().email().max(320).optional(),
    phone: z.string().min(3).max(32).optional(),
  }),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const PRODUCT_EVENTS_PER_MINUTE = 3_000;

class RecordProductEventsBody extends createZodDto(
  z.object({ events: z.array(ProductEventSchema).min(1).max(PRODUCT_EVENT_MAX_BATCH) }),
) {}

@Controller('v1/events')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@AdmitAdminKeyScope('analytics:write')
export class ProductEventsController {
  constructor(
    private readonly productEvents: ProductEventsService,
    @Inject(RateLimitService) private readonly rateLimit: Pick<RateLimitService, 'record'>,
  ) {}

  @Post()
  @HttpCode(200)
  async record(@Body() body: RecordProductEventsBody): Promise<{ items: ProductEventResult[] }> {
    const used = await this.rateLimit.record('product_events_min', body.events.length);
    if (used > PRODUCT_EVENTS_PER_MINUTE) {
      const retryAfterSeconds = 60 - new Date().getUTCSeconds();
      const limited: RateLimitedBody = {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: RATE_LIMITED_CODE,
        retryAfterSeconds,
        message: `${RATE_LIMITED_CODE}: more than ${PRODUCT_EVENTS_PER_MINUTE} product events a minute for this organization. Retry in ${retryAfterSeconds}s.`,
      };
      throw new HttpException(limited, HttpStatus.TOO_MANY_REQUESTS);
    }
    return { items: await this.productEvents.record(body.events) };
  }
}

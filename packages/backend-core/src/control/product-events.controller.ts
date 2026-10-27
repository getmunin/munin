import { Body, Controller, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import {
  AdmitAdminKeyScope,
  ControlPlaneGuard,
} from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
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

class RecordProductEventsBody extends createZodDto(
  z.object({ events: z.array(ProductEventSchema).min(1).max(PRODUCT_EVENT_MAX_BATCH) }),
) {}

@Controller('v1/events')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@AdmitAdminKeyScope('analytics:write')
export class ProductEventsController {
  constructor(private readonly productEvents: ProductEventsService) {}

  @Post()
  @HttpCode(200)
  async record(@Body() body: RecordProductEventsBody): Promise<{ items: ProductEventResult[] }> {
    return { items: await this.productEvents.record(body.events) };
  }
}

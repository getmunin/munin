import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import {
  WebhooksService,
  type WebhookDto,
  type WebhookDeliveryDto,
} from '../modules/webhooks/webhooks.service.ts';

export const WebhookUrl = z
  .string()
  .url()
  .refine((u) => {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'webhook URL must use https://');

const CreateDto = z.object({
  url: WebhookUrl,
  events: z.array(z.string().min(1).max(64)).default([]),
  active: z.boolean().optional(),
});

const PatchDto = z.object({
  url: WebhookUrl.optional(),
  events: z.array(z.string().min(1).max(64)).optional(),
  active: z.boolean().optional(),
});

const DeliveriesQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
});

@Controller('v1/webhooks')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(): Promise<WebhookDto[]> {
    return this.webhooks.list();
  }

  @Get('event-types')
  listEventTypes() {
    return this.webhooks.listEventTypes();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown): Promise<WebhookDto> {
    const parsed = CreateDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.webhooks.create(parsed.data);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: unknown): Promise<WebhookDto> {
    const parsed = PatchDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.webhooks.update(id, parsed.data);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.webhooks.delete(id);
  }

  @Post(':id/rotate-secret')
  rotateSecret(@Param('id') id: string): Promise<WebhookDto> {
    return this.webhooks.rotateSecret(id);
  }

  @Get(':id/deliveries')
  listDeliveries(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<WebhookDeliveryDto[]> {
    const parsed = DeliveriesQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.webhooks.listDeliveries({ webhookId: id, ...parsed.data });
  }
}

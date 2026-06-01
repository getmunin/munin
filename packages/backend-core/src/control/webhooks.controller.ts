import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, asc, eq } from 'drizzle-orm';
import { getCurrentContext, randomToken } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

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

class CreateWebhookBody extends createZodDto(
  z.object({
    url: WebhookUrl,
    events: z.array(z.string().min(1).max(64)).default([]),
    active: z.boolean().optional(),
  }),
) {}

class PatchWebhookBody extends createZodDto(
  z.object({
    url: WebhookUrl.optional(),
    events: z.array(z.string().min(1).max(64)).optional(),
    active: z.boolean().optional(),
  }),
) {}

interface WebhookDto {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  /** Plaintext shared secret — returned ONCE at creation time. */
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

@Controller('v1/webhooks')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class WebhooksController {
  @Get()
  async list(): Promise<WebhookDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.orgId, actor.orgId))
      .orderBy(asc(schema.webhooks.createdAt));
    return rows.map(toDto);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() input: CreateWebhookBody): Promise<WebhookDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const secret = `whsec_${randomToken(24)}`;
    const [row] = await ctx.db
      .insert(schema.webhooks)
      .values({
        orgId: actor.orgId,
        url: input.url,
        secret,
        events: input.events,
        active: input.active ?? true,
      })
      .returning();
    return { ...toDto(row!), secret };
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() input: PatchWebhookBody): Promise<WebhookDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.url !== undefined) updates.url = input.url;
    if (input.events !== undefined) updates.events = input.events;
    if (input.active !== undefined) updates.active = input.active;
    const result = await ctx.db
      .update(schema.webhooks)
      .set(updates)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, actor.orgId)))
      .returning();
    if (!result[0]) throw new NotFoundException(`webhook ${id} not found`);
    return toDto(result[0]);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = await ctx.db
      .delete(schema.webhooks)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, actor.orgId)))
      .returning({ id: schema.webhooks.id });
    if (result.length === 0) throw new NotFoundException(`webhook ${id} not found`);
  }
}

function toDto(row: typeof schema.webhooks.$inferSelect): WebhookDto {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

import {
  BadRequestException,
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
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, asc, eq } from 'drizzle-orm';
import { getCurrentContext, randomToken } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';

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
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
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
  async create(@Body() body: unknown): Promise<WebhookDto> {
    const parsed = CreateDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const secret = `whsec_${randomToken(24)}`;
    const [row] = await ctx.db
      .insert(schema.webhooks)
      .values({
        orgId: actor.orgId,
        url: parsed.data.url,
        secret,
        events: parsed.data.events,
        active: parsed.data.active ?? true,
      })
      .returning();
    return { ...toDto(row!), secret };
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<WebhookDto> {
    const parsed = PatchDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.url !== undefined) updates.url = parsed.data.url;
    if (parsed.data.events !== undefined) updates.events = parsed.data.events;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
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

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';

const PatchDto = z.object({
  name: z.string().max(64).nullable().optional(),
  greeting: z.string().max(500).nullable().optional(),
});

interface AssistantDto {
  id: string;
  orgId: string;
  name: string | null;
  greeting: string | null;
  createdAt: string;
  updatedAt: string;
}

@Controller('api/v1/assistants/me')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class AssistantsController {
  @Get()
  async me(): Promise<AssistantDto> {
    return toDto(await getOrCreate());
  }

  @Patch()
  async update(@Body() body: unknown): Promise<AssistantDto> {
    const parsed = PatchDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);

    const existing = await getOrCreate();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) set.name = emptyToNull(parsed.data.name);
    if (parsed.data.greeting !== undefined) set.greeting = emptyToNull(parsed.data.greeting);

    const ctx = getCurrentContext();
    const [updated] = await ctx.db
      .update(schema.assistants)
      .set(set)
      .where(eq(schema.assistants.id, existing.id))
      .returning();
    return toDto(updated!);
  }
}

async function getOrCreate(): Promise<typeof schema.assistants.$inferSelect> {
  const ctx = getCurrentContext();
  const actor = ctx.actor!;
  const rows = await ctx.db
    .select()
    .from(schema.assistants)
    .where(eq(schema.assistants.orgId, actor.orgId))
    .limit(1);
  if (rows[0]) return rows[0];
  const [created] = await ctx.db
    .insert(schema.assistants)
    .values({ orgId: actor.orgId })
    .onConflictDoNothing({ target: schema.assistants.orgId })
    .returning();
  if (created) return created;
  const retry = await ctx.db
    .select()
    .from(schema.assistants)
    .where(eq(schema.assistants.orgId, actor.orgId))
    .limit(1);
  return retry[0]!;
}

function toDto(row: typeof schema.assistants.$inferSelect): AssistantDto {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    greeting: row.greeting,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emptyToNull(v: string | null): string | null {
  if (v === null) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

const EndUserPatchSchema = z.object({
  externalId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

class CreateEndUserBody extends createZodDto(EndUserPatchSchema) {}

class LookupEndUserBody extends createZodDto(
  z
    .object({
      externalId: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .refine((v) => v.externalId || v.email || v.phone, {
      message: 'at least one of externalId, email, phone is required',
    }),
) {}

interface EndUserDto {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Controller('v1/end-users')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class EndUsersController {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  /**
   * Find or create an EndUser by externalId / email / phone.
   * Returns 200 + the row (whether existing or just-created).
   */
  @Post('lookup')
  @HttpCode(200)
  async lookup(@Body() input: LookupEndUserBody): Promise<EndUserDto> {
    return this.findOrCreate(input);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() input: CreateEndUserBody): Promise<EndUserDto> {
    return this.findOrCreate(input);
  }

  @Get()
  @RequireRole('owner', 'admin')
  async list(@Query('limit') limit?: string): Promise<EndUserDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const take = clampLimit(limit, 50, 200);
    const rows = await ctx.db
      .select()
      .from(schema.endUsers)
      .where(eq(schema.endUsers.orgId, actor.orgId))
      .orderBy(desc(schema.endUsers.createdAt))
      .limit(take);
    return rows.map(toDto);
  }

  @Post(':id/revoke-tokens')
  @HttpCode(200)
  @RequireRole('owner', 'admin')
  async revokeTokens(@Param('id') id: string): Promise<{ revoked: number }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = await ctx.db
      .update(schema.tokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.tokens.endUserId, id),
          eq(schema.tokens.orgId, actor.orgId),
          isNull(schema.tokens.revokedAt),
        ),
      )
      .returning({ id: schema.tokens.id });
    if (result.length > 0) {
      await this.webhooks.emit({
        type: 'end_user.tokens_revoked',
        payload: { endUserId: id, revoked: result.length },
      });
    }
    return { revoked: result.length };
  }

  @Get(':id')
  @RequireRole('owner', 'admin')
  async get(@Param('id') id: string): Promise<EndUserDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.id, id), eq(schema.endUsers.orgId, actor.orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`EndUser ${id} not found`);
    return toDto(row);
  }

  private async findOrCreate(input: z.infer<typeof EndUserPatchSchema>): Promise<EndUserDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    if (input.externalId) {
      const existing = await ctx.db
        .select()
        .from(schema.endUsers)
        .where(
          and(eq(schema.endUsers.orgId, actor.orgId), eq(schema.endUsers.externalId, input.externalId)),
        )
        .limit(1);
      if (existing[0]) return toDto(existing[0]);
    }

    const [created] = await ctx.db
      .insert(schema.endUsers)
      .values({
        orgId: actor.orgId,
        externalId: input.externalId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        name: input.name ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    await this.webhooks.emit({
      type: 'end_user.created',
      payload: {
        endUserId: created!.id,
        externalId: created!.externalId,
        email: created!.email,
      },
    });
    return toDto(created!);
  }
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function toDto(row: typeof schema.endUsers.$inferSelect): EndUserDto {
  return {
    id: row.id,
    externalId: row.externalId,
    email: row.email,
    phone: row.phone,
    name: row.name,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

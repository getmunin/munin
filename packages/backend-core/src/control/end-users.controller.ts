import {
  BadRequestException,
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
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { assertOwnerOrAdmin } from './role-guard.ts';

const EndUserPatchDto = z.object({
  externalId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const LookupDto = z
  .object({
    externalId: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  })
  .refine((v) => v.externalId || v.email || v.phone, {
    message: 'at least one of externalId, email, phone is required',
  });

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

@Controller('api/v1/end-users')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class EndUsersController {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  /**
   * Find or create an EndUser by externalId / email / phone.
   * Returns 200 + the row (whether existing or just-created).
   */
  @Post('lookup')
  @HttpCode(200)
  async lookup(@Body() body: unknown): Promise<EndUserDto> {
    const parsed = LookupDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.findOrCreate(parsed.data);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<EndUserDto> {
    const parsed = EndUserPatchDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.findOrCreate(parsed.data);
  }

  @Get()
  async list(@Query('limit') limit?: string): Promise<EndUserDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
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
  async revokeTokens(@Param('id') id: string): Promise<{ revoked: number }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
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
  async get(@Param('id') id: string): Promise<EndUserDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);
    const rows = await ctx.db
      .select()
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.id, id), eq(schema.endUsers.orgId, actor.orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`EndUser ${id} not found`);
    return toDto(row);
  }

  private async findOrCreate(input: z.infer<typeof EndUserPatchDto>): Promise<EndUserDto> {
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

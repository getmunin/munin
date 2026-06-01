import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@getmunin/db';
import { and, eq, isNull } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret, keyPrefix, WebhookDispatcher } from '@getmunin/core';
import { Inject } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';

const CreateApiKeyDto = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string()).default([]),
});

interface CreatedApiKey {
  id: string;
  name: string;
  /** Plaintext API key — shown ONCE at creation time. */
  key: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
}

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

@Controller('v1/api-keys')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class ApiKeysController {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<CreatedApiKey> {
    const parsed = CreateApiKeyDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!actor.orgId) throw new BadRequestException('No org bound to caller');

    const rawKey = buildApiKey('admin');
    const [row] = await ctx.db
      .insert(schema.apiKeys)
      .values({
        orgId: actor.orgId,
        type: 'admin',
        name: parsed.data.name,
        keyHash: hashSecret(rawKey),
        keyPrefix: keyPrefix(rawKey),
        scopes: parsed.data.scopes,
        createdByUserId: actor.userId ?? null,
      })
      .returning({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        createdAt: schema.apiKeys.createdAt,
      });

    await this.webhooks.emit({
      type: 'api_key.minted',
      payload: {
        apiKeyId: row!.id,
        name: row!.name,
        prefix: row!.prefix,
        scopes: row!.scopes,
      },
    });

    return {
      id: row!.id,
      name: row!.name,
      key: rawKey,
      prefix: row!.prefix,
      scopes: row!.scopes,
      createdAt: row!.createdAt.toISOString(),
    };
  }

  @Get()
  async list(): Promise<ApiKeySummary[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
        revokedAt: schema.apiKeys.revokedAt,
      })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.orgId, actor.orgId), isNull(schema.apiKeys.revokedAt)));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, actor.orgId)))
      .returning({ id: schema.apiKeys.id, prefix: schema.apiKeys.keyPrefix });
    if (result.length === 0) throw new NotFoundException(`API key ${id} not found`);
    await this.webhooks.emit({
      type: 'api_key.revoked',
      payload: { apiKeyId: result[0]!.id, prefix: result[0]!.prefix },
    });
  }
}

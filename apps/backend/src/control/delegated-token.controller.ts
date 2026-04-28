import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { schema } from '@munin/db';
import { and, eq } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret } from '@munin/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';

const MintDto = z
  .object({
    endUserId: z.string().optional(),
    externalId: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    name: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    ttlSeconds: z.number().int().min(60).max(60 * 60 * 24).default(30 * 60),
    audiences: z.array(z.enum(['admin', 'self_service'])).default(['self_service']),
    scopes: z.array(z.string()).default([]),
  })
  .refine((v) => v.endUserId || v.externalId || v.email || v.phone, {
    message: 'at least one of endUserId, externalId, email, phone is required',
  });

interface MintResult {
  accessToken: string;
  tokenId: string;
  endUserId: string;
  expiresAt: string;
  scopes: string[];
  audiences: string[];
}

/**
 * Mint a short-lived end-user delegated token.
 *
 * The org's backend (with admin API key) calls this when starting a customer-
 * facing session (voice call, web chat, etc.). The agent runtime gets the
 * resulting token and uses it as bearer when calling MCP tools — its surface
 * is restricted to self-service tools, scoped to that one EndUser.
 */
@Controller('api/delegated-token')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class DelegatedTokenController {
  @Post()
  @HttpCode(201)
  async mint(@Body() body: unknown): Promise<MintResult> {
    const parsed = MintDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'admin_agent' && actor.type !== 'partner') {
      throw new BadRequestException('only admin or partner credentials may mint delegated tokens');
    }

    // Resolve / upsert EndUser.
    let endUserId = input.endUserId;
    if (!endUserId) {
      if (input.externalId) {
        const found = await ctx.db
          .select({ id: schema.endUsers.id })
          .from(schema.endUsers)
          .where(
            and(eq(schema.endUsers.orgId, actor.orgId), eq(schema.endUsers.externalId, input.externalId)),
          )
          .limit(1);
        endUserId = found[0]?.id;
      }
      if (!endUserId) {
        const [row] = await ctx.db
          .insert(schema.endUsers)
          .values({
            orgId: actor.orgId,
            externalId: input.externalId ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            name: input.name ?? null,
            metadata: input.metadata ?? {},
          })
          .returning({ id: schema.endUsers.id });
        endUserId = row!.id;
      }
    }

    // Issue the token.
    const rawToken = buildApiKey('dlg');
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

    const [token] = await ctx.db
      .insert(schema.tokens)
      .values({
        orgId: actor.orgId,
        type: 'delegated_end_user',
        tokenHash: hashSecret(rawToken),
        scopes: input.scopes,
        audiences: input.audiences,
        endUserId,
        expiresAt,
      })
      .returning({ id: schema.tokens.id });

    return {
      accessToken: rawToken,
      tokenId: token!.id,
      endUserId,
      expiresAt: expiresAt.toISOString(),
      scopes: input.scopes,
      audiences: input.audiences,
    };
  }
}

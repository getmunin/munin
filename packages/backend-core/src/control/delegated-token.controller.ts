import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { buildApiKey, getCurrentContext, hashSecret } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireActorType } from './role.decorator.ts';
import {
  ATTESTED_EMAIL_METADATA_KEY,
  ORG_ATTESTED_EMAIL_SOURCE,
} from '../modules/connectors/identity-provenance.ts';

export const SELF_SERVICE_SCOPES = [
  'bookings:read',
  'bookings:write',
  'cms:read',
  'commerce:read',
  'conv:read',
  'conv:write',
  'crm:read',
  'crm:write',
  'kb:read',
  'outreach:read',
] as const;

export const MintDto = z
  .object({
    endUserId: z.string().optional(),
    externalId: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    name: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    ttlSeconds: z.number().int().min(60).max(60 * 60 * 24).default(30 * 60),
    audiences: z
      .array(z.literal('self_service'))
      .default(['self_service']),
    scopes: z.array(z.enum(SELF_SERVICE_SCOPES)).default([]),
  })
  .refine((v) => v.endUserId || v.externalId || v.email || v.phone, {
    message: 'at least one of endUserId, externalId, email, phone is required',
  });

class MintTokenBody extends createZodDto(MintDto) {}

interface MintResult {
  accessToken: string;
  tokenId: string;
  endUserId: string;
  expiresAt: string;
  scopes: string[];
  audiences: string[];
  attestedEmail: string | null;
}

async function emailHeldByAnotherEndUser(
  db: Db | Tx,
  orgId: string,
  email: string,
  endUserId: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.endUsers.id })
    .from(schema.endUsers)
    .where(
      and(
        eq(schema.endUsers.orgId, orgId),
        sql`lower(${schema.endUsers.email}) = ${email}`,
        ...(endUserId ? [ne(schema.endUsers.id, endUserId)] : []),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function bindAttestedEmail(
  db: Db | Tx,
  orgId: string,
  endUserId: string,
  email: string,
): Promise<void> {
  const [row] = await db
    .select({ email: schema.endUsers.email })
    .from(schema.endUsers)
    .where(eq(schema.endUsers.id, endUserId))
    .limit(1);
  const current = row?.email?.trim().toLowerCase() ?? null;
  if (current && current !== email) {
    throw new BadRequestException(
      'delegated_email_mismatch: this end user already carries a different email; mint with the email on record, or omit email to mint a token that cannot change bookings',
    );
  }
  if (!current && (await emailHeldByAnotherEndUser(db, orgId, email, endUserId))) {
    throw new ConflictException(
      'delegated_email_conflict: another end user in this organization already carries this email; mint for that end user instead',
    );
  }
  await db
    .update(schema.endUsers)
    .set({
      ...(current ? {} : { email }),
      metadata: sql`COALESCE(${schema.endUsers.metadata}, '{}'::jsonb) || ${JSON.stringify({ emailSource: ORG_ATTESTED_EMAIL_SOURCE })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(schema.endUsers.id, endUserId));
}

@Controller('v1/tokens/delegated')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireActorType('admin_agent')
export class DelegatedTokenController {
  @Post()
  @HttpCode(201)
  async mint(@Body() input: MintTokenBody): Promise<MintResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const attestedEmail = input.email?.trim().toLowerCase() ?? null;

    let endUserId = input.endUserId;
    if (endUserId) {
      const owned = await ctx.db
        .select({ id: schema.endUsers.id })
        .from(schema.endUsers)
        .where(and(eq(schema.endUsers.orgId, actor.orgId), eq(schema.endUsers.id, endUserId)))
        .limit(1);
      if (!owned[0]) {
        throw new BadRequestException('end_user_not_found: endUserId does not belong to this org');
      }
    }
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
      } else if (attestedEmail) {
        const found = await ctx.db
          .select({ id: schema.endUsers.id })
          .from(schema.endUsers)
          .where(
            and(
              eq(schema.endUsers.orgId, actor.orgId),
              sql`lower(${schema.endUsers.email}) = ${attestedEmail}`,
            ),
          )
          .limit(1);
        endUserId = found[0]?.id;
      }
      if (!endUserId) {
        if (attestedEmail && (await emailHeldByAnotherEndUser(ctx.db, actor.orgId, attestedEmail, null))) {
          throw new ConflictException(
            'delegated_email_conflict: another end user in this organization already carries this email; mint for that end user instead',
          );
        }
        const [row] = await ctx.db
          .insert(schema.endUsers)
          .values({
            orgId: actor.orgId,
            externalId: input.externalId ?? null,
            email: attestedEmail,
            phone: input.phone ?? null,
            name: input.name ?? null,
            metadata: input.metadata ?? {},
          })
          .returning({ id: schema.endUsers.id });
        endUserId = row!.id;
      }
    }

    if (attestedEmail) {
      await bindAttestedEmail(ctx.db, actor.orgId, endUserId, attestedEmail);
    }

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
        metadata: attestedEmail ? { [ATTESTED_EMAIL_METADATA_KEY]: attestedEmail } : {},
      })
      .returning({ id: schema.tokens.id });

    return {
      accessToken: rawToken,
      tokenId: token!.id,
      endUserId,
      expiresAt: expiresAt.toISOString(),
      scopes: input.scopes,
      audiences: input.audiences,
      attestedEmail,
    };
  }
}

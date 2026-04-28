import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@munin/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  buildApiKey,
  getCurrentContext,
  hashSecret,
  keyPrefix,
  randomToken,
  type Mailer,
} from '@munin/core';
import { MAILER } from '../common/mail/mail.module.js';

export interface ProvisionInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName?: string;
  metadata?: Record<string, unknown>;
}

export interface ProvisionedOrg {
  org: { id: string; name: string; slug: string; partnerId: string | null };
  adminApiKey: string;
  ownerClaim: { token: string; expiresAt: string; email: string };
}

export interface PartnerOrgDto {
  id: string;
  name: string;
  slug: string;
  partnerId: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const OWNER_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class PartnersService {
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  /**
   * Provision a new org for the partner, mint a fresh admin API key for the
   * customer's backend integration, and create an owner-claim token the
   * customer follows from email to set their direct dashboard password.
   *
   * The plaintext admin key is returned ONCE. We only store its hash.
   */
  async provisionOrg(input: ProvisionInput): Promise<ProvisionedOrg> {
    const ctx = getCurrentContext();
    const partnerId = ctx.actor!.partnerId!;

    const existingSlug = await ctx.db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.slug, input.slug))
      .limit(1);
    if (existingSlug[0]) {
      throw new ConflictException(`partner_slug_conflict: slug "${input.slug}" already in use`);
    }

    const [org] = await ctx.db
      .insert(schema.orgs)
      .values({
        name: input.name,
        slug: input.slug,
        partnerId,
        settings: input.metadata ? { partnerProvisionMetadata: input.metadata } : {},
      })
      .returning();

    const adminKey = buildApiKey('admin');
    await ctx.db.insert(schema.apiKeys).values({
      orgId: org!.id,
      type: 'admin',
      name: 'partner-provisioned',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    const claimToken = randomToken(24);
    const expiresAt = new Date(Date.now() + OWNER_CLAIM_TTL_SECONDS * 1000);
    await ctx.db.insert(schema.verifications).values({
      identifier: `owner-claim:${org!.id}:${input.ownerEmail}`,
      value: hashSecret(claimToken),
      expiresAt,
    });
    await this.sendOwnerClaim(input.ownerEmail, input.ownerName, org!.id, claimToken);

    return {
      org: { id: org!.id, name: org!.name, slug: org!.slug, partnerId: org!.partnerId },
      adminApiKey: adminKey,
      ownerClaim: {
        token: claimToken,
        expiresAt: expiresAt.toISOString(),
        email: input.ownerEmail,
      },
    };
  }

  async listOrgs(): Promise<PartnerOrgDto[]> {
    const ctx = getCurrentContext();
    const partnerId = ctx.actor!.partnerId!;
    const rows = await ctx.db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.partnerId, partnerId))
      .orderBy(asc(schema.orgs.createdAt));
    return rows.map(toOrgDto);
  }

  async getOrg(id: string): Promise<PartnerOrgDto> {
    const ctx = getCurrentContext();
    const partnerId = ctx.actor!.partnerId!;
    const rows = await ctx.db
      .select()
      .from(schema.orgs)
      .where(and(eq(schema.orgs.id, id), eq(schema.orgs.partnerId, partnerId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`partner_not_found: org ${id} not provisioned by this partner`);
    return toOrgDto(row);
  }

  async patchOrg(id: string, patch: { name?: string }): Promise<PartnerOrgDto> {
    const ctx = getCurrentContext();
    const partnerId = ctx.actor!.partnerId!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name;
    const rows = await ctx.db
      .update(schema.orgs)
      .set(updates)
      .where(and(eq(schema.orgs.id, id), eq(schema.orgs.partnerId, partnerId)))
      .returning();
    const row = rows[0];
    if (!row) throw new NotFoundException(`partner_not_found: org ${id} not provisioned by this partner`);
    return toOrgDto(row);
  }

  /**
   * Mint a fresh owner-claim token (e.g. when re-sending the email) without
   * revoking previously-issued ones. The customer can use any unexpired one.
   */
  async resendOwnerInvite(
    id: string,
    email: string,
  ): Promise<{ token: string; expiresAt: string; email: string }> {
    const ctx = getCurrentContext();
    await this.getOrg(id); // ensures partner owns the org
    const claimToken = randomToken(24);
    const expiresAt = new Date(Date.now() + OWNER_CLAIM_TTL_SECONDS * 1000);
    await ctx.db.insert(schema.verifications).values({
      identifier: `owner-claim:${id}:${email}`,
      value: hashSecret(claimToken),
      expiresAt,
    });
    await this.sendOwnerClaim(email, undefined, id, claimToken);
    return { token: claimToken, expiresAt: expiresAt.toISOString(), email };
  }

  private async sendOwnerClaim(
    email: string,
    name: string | undefined,
    orgId: string,
    token: string,
  ): Promise<void> {
    const webBase = (process.env.MUNIN_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    const url = `${webBase}/claim?org=${encodeURIComponent(orgId)}&token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const greeting = name ? `Hi ${name},` : 'Hi,';
    try {
      await this.mailer.send({
        to: email,
        subject: 'Claim your Munin account',
        text: [
          greeting,
          '',
          'A Munin org was just created for you by an integration partner.',
          'Set your password to access it directly (the link is valid for 7 days):',
          '',
          url,
          '',
          'If you weren\'t expecting this, you can ignore the email — the org will keep working through the partner.',
        ].join('\n'),
      });
    } catch {
      // Email failures must not break provisioning — the partner still gets
      // back the claim token in the API response and can resend later.
    }
  }

  /**
   * The customer revoking partner access. Removes the partner_id pointer and
   * disables every admin API key the partner provisioned. Customer keeps
   * the data + their direct-claimed password.
   */
  async revokePartnerAccess(orgId: string): Promise<{ revoked: true }> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.orgId, orgId),
          eq(schema.apiKeys.name, 'partner-provisioned'),
          isNull(schema.apiKeys.revokedAt),
        ),
      );
    await ctx.db
      .update(schema.orgs)
      .set({ partnerId: null, updatedAt: new Date() })
      .where(eq(schema.orgs.id, orgId));
    return { revoked: true };
  }
}

function toOrgDto(row: typeof schema.orgs.$inferSelect): PartnerOrgDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    partnerId: row.partnerId,
    settings: row.settings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

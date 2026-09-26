import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type PiiIdentityRefKind } from '@getmunin/core';
import { PiiLexiconService } from './pii-lexicon.service.ts';
import { isPiiNerEnabled } from './pii-config.ts';
import {
  PII_SETTINGS_KEY,
  parsePiiOrgPolicy,
  readPiiOrgPolicy,
  type PiiOrgPolicy,
} from './pii-org-policy.ts';
import type { PiiLayer } from './pii-result-filter.service.ts';
import { resultRows } from './rows.ts';

export interface PiiStatusDto {
  externalRaw: PiiOrgPolicy['externalRaw'];
  withholdUncheckedText: boolean;
  nerEnabled: boolean;
  layers: PiiLayer[];
  coverage: {
    messages: number;
    annotated: number;
    lastAnnotatedAt: string | null;
  };
}

export interface PiiTokenIdentityDto {
  token: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  refs: Array<{ kind: PiiIdentityRefKind; id: string }>;
}

@Injectable()
export class PiiStatusService {
  constructor(private readonly lexicons: PiiLexiconService) {}

  async getStatus(): Promise<PiiStatusDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    return this.toDto(await readPiiOrgPolicy(ctx.db, orgId), orgId);
  }

  async configure(input: Partial<PiiOrgPolicy>): Promise<PiiStatusDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const patch: Partial<PiiOrgPolicy> = {};
    if (input.externalRaw !== undefined) patch.externalRaw = input.externalRaw;
    if (input.withholdUncheckedText !== undefined) patch.withholdUncheckedText = input.withholdUncheckedText;
    const [updated] = await ctx.db
      .update(schema.orgs)
      .set({
        settings: sql`${schema.orgs.settings} || jsonb_build_object(${PII_SETTINGS_KEY}::text, coalesce(${schema.orgs.settings} -> ${PII_SETTINGS_KEY}::text, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.orgs.id, orgId))
      .returning({ settings: schema.orgs.settings });
    return this.toDto(parsePiiOrgPolicy(updated?.settings ?? {}), orgId);
  }

  async lookupToken(token: string): Promise<PiiTokenIdentityDto> {
    const lexicon = await this.lexicons.forCurrentOrg();
    const identity = lexicon.byToken.get(token.trim().toLowerCase());
    if (!identity) {
      throw new NotFoundException({
        message: `pii_token_not_found: no contact in this org has the token ${token}`,
        code: 'pii_token_not_found',
      });
    }
    return {
      token: identity.token,
      name: identity.name,
      email: identity.email,
      phone: identity.phone,
      refs: [...identity.refs],
    };
  }

  private async toDto(policy: PiiOrgPolicy, orgId: string): Promise<PiiStatusDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db.execute(sql`
      SELECT
        (SELECT count(*) FROM conv_messages WHERE org_id = ${orgId})::int AS messages,
        (SELECT count(*) FROM pii_message_annotations WHERE org_id = ${orgId} AND ner_version IS NOT NULL)::int AS annotated,
        (SELECT max(annotated_at) FROM pii_message_annotations WHERE org_id = ${orgId}) AS last_annotated_at
    `);
    const row = resultRows<{ messages: number; annotated: number; last_annotated_at: string | Date | null }>(rows)[0];
    const ner = isPiiNerEnabled();
    const last = row?.last_annotated_at ?? null;
    return {
      externalRaw: policy.externalRaw,
      withholdUncheckedText: policy.withholdUncheckedText,
      nerEnabled: ner,
      layers: ner ? ['deterministic', 'directory', 'ner'] : ['deterministic', 'directory'],
      coverage: {
        messages: row?.messages ?? 0,
        annotated: row?.annotated ?? 0,
        lastAnnotatedAt: last === null ? null : new Date(last).toISOString(),
      },
    };
  }
}

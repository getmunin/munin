import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@getmunin/db';
import {
  buildPiiLexicon,
  getCurrentContext,
  type PiiIdentityRecord,
  type PiiIdentityRefKind,
  type PiiLexicon,
} from '@getmunin/core';
import { readPseudonymSecret } from './pii-config.ts';
import { resultRows } from './rows.ts';

const MAX_CACHED_ORGS = 200;

interface CachedLexicon {
  version: string;
  lexicon: PiiLexicon;
}

@Injectable()
export class PiiLexiconService {
  private readonly cache = new Map<string, CachedLexicon>();

  async forCurrentOrg(): Promise<PiiLexicon> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor?.orgId;
    if (!orgId) throw new Error('pii lexicon requires an org-scoped actor');
    const version = await this.version(ctx.db, orgId);
    const hit = this.cache.get(orgId);
    if (hit && hit.version === version) {
      this.cache.delete(orgId);
      this.cache.set(orgId, hit);
      return hit.lexicon;
    }
    const lexicon = await this.load(ctx.db, orgId);
    this.cache.delete(orgId);
    this.cache.set(orgId, { version, lexicon });
    while (this.cache.size > MAX_CACHED_ORGS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return lexicon;
  }

  private async version(db: Db | Tx, orgId: string): Promise<string> {
    const rows = await db.execute(sql`
      SELECT
        (SELECT count(*)::text || '/' || coalesce(max(updated_at)::text, '') FROM crm_contacts WHERE org_id = ${orgId}) AS crm,
        (SELECT count(*)::text || '/' || coalesce(max(updated_at)::text, '') FROM conv_contacts WHERE org_id = ${orgId}) AS conv,
        (SELECT count(*)::text || '/' || coalesce(max(updated_at)::text, '') FROM end_users WHERE org_id = ${orgId}) AS eu,
        (SELECT count(*)::text || '/' || coalesce(max(created_at)::text, '') FROM pii_spans WHERE org_id = ${orgId}) AS spans
    `);
    const row = resultRows<Record<string, string | null>>(rows)[0] ?? {};
    return [row.crm, row.conv, row.eu, row.spans].join('|');
  }

  private async load(db: Db | Tx, orgId: string): Promise<PiiLexicon> {
    const identityRows = await db.execute(sql`
      SELECT 'crm_contact' AS kind, id, name, email, phone FROM crm_contacts WHERE org_id = ${orgId}
      UNION ALL
      SELECT 'conv_contact' AS kind, id, name, email, phone FROM conv_contacts WHERE org_id = ${orgId}
      UNION ALL
      SELECT 'end_user' AS kind, id, name, email, phone FROM end_users WHERE org_id = ${orgId}
    `);
    const records: PiiIdentityRecord[] = resultRows<{
      kind: PiiIdentityRefKind;
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
    }>(identityRows);
    const spanRows = await db.execute(sql`
      SELECT DISTINCT surface FROM pii_spans WHERE org_id = ${orgId} AND kind = 'person'
    `);
    const detectedNames = resultRows<{ surface: string }>(spanRows).map((r) => r.surface);
    return buildPiiLexicon({ orgId, secret: readPseudonymSecret(), records, detectedNames });
  }
}

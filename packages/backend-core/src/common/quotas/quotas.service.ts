import { Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';

export const QUOTAS_SERVICE = Symbol('QUOTAS_SERVICE');

export class QuotaExceededError extends Error {
  readonly code = 'quota_exceeded';
  constructor(public readonly resource: string, public readonly cap: number) {
    super(`quota_exceeded: this org is at the ${resource} limit (${cap}). Upgrade or delete unused rows.`);
  }
}

export type QuotaResource =
  | 'kb_documents'
  | 'kb_spaces'
  | 'cms_collections'
  | 'cms_entries'
  | 'cms_assets'
  | 'crm_contacts';

export type QuotaCallKind = 'mcp_tool' | 'api_request';

const FREE_TIER_QUOTAS: Record<QuotaResource, number> = {
  kb_documents: 10_000,
  kb_spaces: 100,
  cms_collections: 50,
  cms_entries: 10_000,
  cms_assets: 1_000,
  crm_contacts: 1_000,
};

interface OrgSettings {
  quotas?: Partial<Record<QuotaResource, number>>;
}

const TABLE_FOR: Record<QuotaResource, string> = {
  kb_documents: 'kb_documents',
  kb_spaces: 'kb_spaces',
  cms_collections: 'cms_collections',
  cms_entries: 'cms_entries',
  cms_assets: 'cms_assets',
  crm_contacts: 'crm_contacts',
};

function isEnabled(): boolean {
  const raw = process.env.MUNIN_QUOTAS_ENABLED;
  if (raw === undefined) return false;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export abstract class QuotasService {
  abstract assertCanAdd(resource: QuotaResource): Promise<void>;
  abstract recordCall(kind: QuotaCallKind, key?: string): Promise<void>;
  abstract cap(orgId: string, resource: QuotaResource): Promise<number>;
  abstract count(resource: QuotaResource): Promise<number>;
}

/**
 * Default row-count quota implementation. Opt-in via MUNIN_QUOTAS_ENABLED so
 * OSS self-hosters aren't capped on their own hardware. When enabled, the
 * count runs inside the request transaction so the count and the insert see
 * the same MVCC snapshot. `recordCall` is a no-op here — call-count quotas
 * require a counter table and live in the cloud override.
 */
@Injectable()
export class DefaultQuotasService extends QuotasService {
  async assertCanAdd(resource: QuotaResource): Promise<void> {
    if (!isEnabled()) return;
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    if (!orgId) return;
    const cap = await this.cap(orgId, resource);
    const used = await this.count(resource);
    if (used >= cap) throw new QuotaExceededError(resource, cap);
  }

  recordCall(_kind: QuotaCallKind, _key?: string): Promise<void> {
    return Promise.resolve();
  }

  async cap(orgId: string, resource: QuotaResource): Promise<number> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ settings: schema.orgs.settings })
      .from(schema.orgs)
      .where(sql`${schema.orgs.id} = ${orgId}`)
      .limit(1);
    const settings = (rows[0]?.settings ?? {}) as OrgSettings;
    return settings.quotas?.[resource] ?? FREE_TIER_QUOTAS[resource];
  }

  async count(resource: QuotaResource): Promise<number> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const table = TABLE_FOR[resource];
    const rows = await ctx.db.execute<{ n: number } & Record<string, unknown>>(
      sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`,
    );
    return rows[0]?.n ?? 0;
  }
}

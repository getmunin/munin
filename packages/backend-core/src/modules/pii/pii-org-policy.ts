import { eq } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { DEFAULT_PII_ORG_FLOOR, type PiiOrgFloor } from './pii-policy.ts';

export const PII_SETTINGS_KEY = 'pii.mcp';

export interface PiiOrgPolicy extends PiiOrgFloor {
  withholdUncheckedText: boolean;
}

export const DEFAULT_PII_ORG_POLICY: PiiOrgPolicy = {
  ...DEFAULT_PII_ORG_FLOOR,
  withholdUncheckedText: false,
};

export function parsePiiOrgPolicy(settings: Record<string, unknown>): PiiOrgPolicy {
  const raw = settings[PII_SETTINGS_KEY];
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PII_ORG_POLICY;
  const record = raw as Record<string, unknown>;
  return {
    externalRaw: record.externalRaw === 'forbid' ? 'forbid' : 'allow',
    withholdUncheckedText: record.withholdUncheckedText === true,
  };
}

export async function readPiiOrgPolicy(db: Db | Tx, orgId: string): Promise<PiiOrgPolicy> {
  const rows = await db
    .select({ settings: schema.orgs.settings })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId))
    .limit(1);
  return parsePiiOrgPolicy(rows[0]?.settings ?? {});
}

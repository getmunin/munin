import { eq } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { DEFAULT_PII_ORG_FLOOR, type PiiOrgFloor } from './pii-policy.ts';

export const PII_SETTINGS_KEY = 'pii.mcp';

export function parsePiiOrgFloor(settings: Record<string, unknown>): PiiOrgFloor {
  const raw = settings[PII_SETTINGS_KEY];
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PII_ORG_FLOOR;
  const record = raw as Record<string, unknown>;
  return { externalRaw: record.externalRaw === 'forbid' ? 'forbid' : 'allow' };
}

export async function readPiiOrgFloor(db: Db | Tx, orgId: string): Promise<PiiOrgFloor> {
  const rows = await db
    .select({ settings: schema.orgs.settings })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId))
    .limit(1);
  return parsePiiOrgFloor(rows[0]?.settings ?? {});
}

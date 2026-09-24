import { schema, type Db, type Tx } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { NATIONAL_ID_DETECTORS, type NationalIdDetector } from '@getmunin/core';
import { REDACTION_OFF, type InboundRedactionPolicy } from './inbound-redaction.ts';

export const REDACTION_SETTINGS_KEY = 'conv.inboundRedaction';

export function parseRedactionPolicy(settings: Record<string, unknown>): InboundRedactionPolicy {
  const raw = settings[REDACTION_SETTINGS_KEY];
  if (typeof raw !== 'object' || raw === null) return REDACTION_OFF;
  const record = raw as Record<string, unknown>;

  const policy =
    record.policy === 'mask' || record.policy === 'remove' || record.policy === 'off'
      ? record.policy
      : 'off';
  const minConfidence = record.minConfidence === 'medium' ? 'medium' : 'high';
  const detectors = Array.isArray(record.detectors)
    ? record.detectors.filter((d): d is NationalIdDetector =>
        NATIONAL_ID_DETECTORS.includes(d as NationalIdDetector),
      )
    : [];

  return { detectors: [...new Set(detectors)], policy, minConfidence };
}

export function isRedactionConfigured(settings: Record<string, unknown>): boolean {
  const raw = settings[REDACTION_SETTINGS_KEY];
  return typeof raw === 'object' && raw !== null;
}

export interface RedactionState {
  policy: InboundRedactionPolicy;
  configured: boolean;
}

export async function readRedactionState(db: Db | Tx, orgId: string): Promise<RedactionState> {
  const rows = await db
    .select({ settings: schema.orgs.settings })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId))
    .limit(1);
  const settings = rows[0]?.settings ?? {};
  return { policy: parseRedactionPolicy(settings), configured: isRedactionConfigured(settings) };
}

export async function readRedactionPolicy(
  db: Db | Tx,
  orgId: string,
): Promise<InboundRedactionPolicy> {
  return (await readRedactionState(db, orgId)).policy;
}

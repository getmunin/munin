import { createHash } from 'node:crypto';

export interface FingerprintableMerge {
  contactAId: string;
  contactBId: string;
  recommendedKeeperId: string;
  recommendedPatch: Record<string, unknown>;
  confidence: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

export function mergeFingerprint(proposal: FingerprintableMerge): string {
  const canonical = JSON.stringify([
    proposal.contactAId,
    proposal.contactBId,
    proposal.recommendedKeeperId,
    proposal.confidence,
    stable(proposal.recommendedPatch ?? {}),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

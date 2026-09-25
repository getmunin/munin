import type { ActorIdentity, Audience } from '@getmunin/core';
import { AGENT_HOST_ACTOR_PREFIX, PII_RAW_SCOPE } from '@getmunin/types';

export type PiiMode = 'raw' | 'pseudonymized';

export type PiiModeReason =
  | 'in_house_agent'
  | 'self_service'
  | 'org_requires_pseudonymization'
  | 'raw_scope'
  | 'default';

export interface PiiModeDecision {
  mode: PiiMode;
  reason: PiiModeReason;
}

export interface PiiOrgFloor {
  externalRaw: 'allow' | 'forbid';
}

export const DEFAULT_PII_ORG_FLOOR: PiiOrgFloor = { externalRaw: 'allow' };

export function decidePiiMode(
  actor: ActorIdentity,
  audience: Audience,
  floor: PiiOrgFloor = DEFAULT_PII_ORG_FLOOR,
): PiiModeDecision {
  if (actor.id.startsWith(AGENT_HOST_ACTOR_PREFIX)) return { mode: 'raw', reason: 'in_house_agent' };
  if (audience === 'self_service') return { mode: 'raw', reason: 'self_service' };
  if (floor.externalRaw === 'forbid') {
    return { mode: 'pseudonymized', reason: 'org_requires_pseudonymization' };
  }
  if (actor.hasScope(PII_RAW_SCOPE)) return { mode: 'raw', reason: 'raw_scope' };
  return { mode: 'pseudonymized', reason: 'default' };
}

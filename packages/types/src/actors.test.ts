import { describe, it, expect } from 'vitest';
import {
  actorKindFromId,
  AGENT_HOST_ACTOR,
  AGENT_HOST_ACTOR_PREFIX,
  SYSTEM_ACTOR_IDS,
} from './actors.ts';

describe('actorKindFromId', () => {
  it('places the in-process runtime and its per-end-user actors as agents', () => {
    expect(actorKindFromId(AGENT_HOST_ACTOR)).toBe('agent');
    expect(actorKindFromId(`${AGENT_HOST_ACTOR_PREFIX}org_123`)).toBe('agent');
    expect(actorKindFromId(`${AGENT_HOST_ACTOR_PREFIX}org_123:eu_456`)).toBe('agent');
  });

  it('places every declared synthetic actor as system', () => {
    for (const id of SYSTEM_ACTOR_IDS) expect(actorKindFromId(id)).toBe('system');
  });

  it('does not infer a kind from a Drizzle-style id prefix', () => {
    expect(actorKindFromId('usr_abc')).toBe('unknown');
    expect(actorKindFromId('akey_abc')).toBe('unknown');
    expect(actorKindFromId('4cTnreOpQUnfsageQbC3S1a774COphfZ')).toBe('unknown');
  });

  it('does not treat an id that merely contains a synthetic name as synthetic', () => {
    expect(actorKindFromId('agent-hostile')).toBe('unknown');
    expect(actorKindFromId('not-conv-scheduler')).toBe('unknown');
  });
});

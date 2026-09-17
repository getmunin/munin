import type { ActorIdentity, ActorType, Audience } from '@getmunin/core';

const ADMIN_ELIGIBLE_ACTOR_TYPES: readonly ActorType[] = ['admin_agent', 'user'];

export function deriveMcpAudience(actor: ActorIdentity): Audience | null {
  if (ADMIN_ELIGIBLE_ACTOR_TYPES.includes(actor.type) && actor.audiences.includes('admin')) {
    return 'admin';
  }
  if (actor.type === 'user') return null;
  return 'self_service';
}

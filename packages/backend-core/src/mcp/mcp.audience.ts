import type { ActorIdentity, ActorType, Audience } from '@getmunin/core';

const ADMIN_ELIGIBLE_ACTOR_TYPES: readonly ActorType[] = ['admin_agent', 'user'];

export function deriveMcpAudience(actor: ActorIdentity): Audience {
  return ADMIN_ELIGIBLE_ACTOR_TYPES.includes(actor.type) && actor.audiences.includes('admin')
    ? 'admin'
    : 'self_service';
}

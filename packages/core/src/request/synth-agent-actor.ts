import { AGENT_HOST_ACTOR_PREFIX } from '@getmunin/types';
import { ActorIdentity, type Audience } from './context.ts';

export function buildAdminAgentActor(orgId: string): ActorIdentity {
  return new ActorIdentity(
    'admin_agent',
    `${AGENT_HOST_ACTOR_PREFIX}${orgId}`,
    orgId,
    ['*'],
    ['admin'],
  );
}

export interface EndUserAgentActorInput {
  orgId: string;
  endUserId: string;
  scopes?: readonly string[];
  audiences?: readonly Audience[];
}

export function buildEndUserAgentActor(input: EndUserAgentActorInput): ActorIdentity {
  const scopes = input.scopes ?? [];
  const audiences = input.audiences ?? (['self_service'] as const);
  return new ActorIdentity(
    'end_user_agent',
    `${AGENT_HOST_ACTOR_PREFIX}${input.orgId}:${input.endUserId}`,
    input.orgId,
    scopes,
    audiences,
    input.endUserId,
  );
}

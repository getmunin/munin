import { ActorIdentity, type Audience } from './context.js';

export function buildAdminAgentActor(orgId: string): ActorIdentity {
  return new ActorIdentity('admin_agent', `agent-host:${orgId}`, orgId, ['*'], ['admin']);
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
    `agent-host:${input.orgId}:${input.endUserId}`,
    input.orgId,
    scopes,
    audiences,
    input.endUserId,
  );
}

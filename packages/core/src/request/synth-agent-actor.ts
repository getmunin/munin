import { ActorIdentity } from './context.js';

export function buildAdminAgentActor(orgId: string): ActorIdentity {
  return new ActorIdentity('admin_agent', `agent-host:${orgId}`, orgId, ['*'], ['admin']);
}

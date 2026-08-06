import { api } from '../api';
import {
  isSetupIncomplete,
  type AgentConfigStatusDto,
  type MembershipDto,
} from './setup-status';

export async function resolvePostAuthDestination(fallback: string): Promise<string> {
  try {
    const [config, memberships] = await Promise.all([
      api<AgentConfigStatusDto>('/v1/agent-config'),
      api<MembershipDto[]>('/v1/me/memberships'),
    ]);
    return isSetupIncomplete(config, memberships) ? '/setup' : fallback;
  } catch {
    return fallback;
  }
}

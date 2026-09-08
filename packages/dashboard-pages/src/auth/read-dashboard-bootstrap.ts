import 'server-only';
import { cookies } from 'next/headers';
import type { SetupStateDto } from '../components/first-run/setup-snapshot';
import { fetchJsonWithCookie } from './api-cookie-fetch';
import type { DashboardBootstrap } from './dashboard-bootstrap';
import { isSetupIncomplete, type AgentConfigStatusDto, type MembershipDto } from './setup-status';

type OrgRole = 'owner' | 'admin' | 'member';

interface OrgMembershipDto extends MembershipDto {
  slug: string;
}

function read<T>(path: string, cookie: string): Promise<T | null> {
  return fetchJsonWithCookie<T>(path, cookie, { label: 'dashboard-bootstrap' });
}

export async function readDashboardBootstrap(): Promise<DashboardBootstrap | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.toString();
  if (!cookie) return null;

  const [memberships, config, setup] = await Promise.all([
    read<OrgMembershipDto[]>('/v1/me/memberships', cookie),
    read<AgentConfigStatusDto>('/v1/agent-config', cookie),
    read<SetupStateDto>('/v1/overview/setup', cookie),
  ]);
  if (!memberships || !config || !setup) return null;

  const active = memberships.length === 1 ? memberships[0] : null;
  if (!active || !isOrgRole(active.role)) return null;
  if (isSetupIncomplete(config, memberships)) return null;

  return {
    membership: {
      orgId: active.orgId,
      name: active.name,
      slug: active.slug,
      role: active.role,
      isDefault: active.isDefault,
    },
    providerConfigured: config.providerConfigured,
    setup,
  };
}

function isOrgRole(value: string): value is OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

import 'server-only';
import { cookies } from 'next/headers';
import { redirect as externalRedirect } from 'next/navigation';
import { redirect } from '../i18n-navigation';
import { oauthResumeFromSearchParams, safeRedirect } from './post-signin-redirect';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type OrgRole = 'owner' | 'admin' | 'member';

interface MembershipDto {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  isDefault: boolean;
}

interface AgentConfigStatusDto {
  providerConfigured: boolean;
}

async function fetchWithCookies<T>(path: string, cookieHeader: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn('[server-session] fetch failed', path, err);
    return null;
  }
}

export interface ServerSession {
  user: { id: string; email?: string | null } & Record<string, unknown>;
  session: { id: string } & Record<string, unknown>;
}

export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API_URL}/auth/get-session`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerSession | null;
    if (!data || !data.user || !data.session) return null;
    return data;
  } catch (err) {
    console.warn('[server-session] fetch failed', err);
    return null;
  }
}

export async function redirectIfAuthenticated(opts: {
  locale: string;
  redirectParam?: string | string[] | null;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<void> {
  const session = await getServerSession();
  if (!session) return;
  const resume = opts.searchParams ? oauthResumeFromSearchParams(opts.searchParams) : null;
  if (resume) externalRedirect(resume);
  const raw = Array.isArray(opts.redirectParam) ? opts.redirectParam[0] : opts.redirectParam;
  redirect({ href: safeRedirect(raw ?? null), locale: opts.locale });
}

export async function redirectIfSetupIncomplete(opts: {
  locale: string;
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<void> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return;

  const [config, memberships] = await Promise.all([
    fetchWithCookies<AgentConfigStatusDto>('/v1/agent-config', cookieHeader),
    fetchWithCookies<MembershipDto[]>('/v1/me/memberships', cookieHeader),
  ]);
  if (!config || !memberships) return;

  const active = memberships.find((m) => m.isDefault) ?? memberships[0] ?? null;
  if (!active) return;
  const role = isOrgRole(active.role) ? active.role : null;
  if (role !== 'owner' && role !== 'admin') return;

  const orgNamed = active.name.trim().length > 0;
  const setupIncomplete = !config.providerConfigured || !orgNamed;
  if (!setupIncomplete) return;

  const query = serializeSearchParams(opts.searchParams);
  redirect({ href: query ? `/setup?${query}` : '/setup', locale: opts.locale });
}

function serializeSearchParams(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, value);
    }
  }
  return params.toString();
}

function isOrgRole(value: string): value is OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

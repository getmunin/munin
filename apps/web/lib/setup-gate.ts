import { SUPPORTED_LOCALES } from '../i18n/locales';

const DASHBOARD_ROOT = new RegExp(`^/(?:${SUPPORTED_LOCALES.join('|')})/dashboard/?$`);

export interface MembershipDto {
  orgId: string;
  name: string;
  role: string;
  isDefault: boolean;
}

export interface AgentConfigStatusDto {
  providerConfigured: boolean;
}

export function isSetupGatedPath(pathname: string): boolean {
  return DASHBOARD_ROOT.test(pathname);
}

export function setupPathFor(pathname: string): string {
  return pathname.replace(/\/dashboard\/?$/, '/setup');
}

export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.includes('session_token');
}

export function isSetupIncomplete(
  config: AgentConfigStatusDto | null,
  memberships: MembershipDto[] | null,
): boolean {
  if (!config || !memberships) return false;

  const active = memberships.find((m) => m.isDefault) ?? memberships[0] ?? null;
  if (!active) return false;
  if (active.role !== 'owner' && active.role !== 'admin') return false;

  return !config.providerConfigured || active.name.trim().length === 0;
}

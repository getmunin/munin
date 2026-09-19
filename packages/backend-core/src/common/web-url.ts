import { orgDashboardPath, stripTrailingSlashes } from '@getmunin/types';

let orgScopedDashboard = false;

export function registerOrgScopedDashboard(enabled: boolean): void {
  orgScopedDashboard = enabled;
}

export function dashboardIsOrgScoped(): boolean {
  return orgScopedDashboard;
}

export function readWebBaseUrl(): string {
  return stripTrailingSlashes(process.env.MUNIN_WEB_URL ?? 'http://localhost:3000');
}

function scoped(path: string, orgId: string): string {
  return orgScopedDashboard ? orgDashboardPath(path, orgId) : path;
}

export function dashboardUrl(orgId: string, path = ''): string {
  return `${readWebBaseUrl()}${scoped(`/dashboard${path}`, orgId)}`;
}

export function absoluteWebUrl(href: string, orgId: string): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (!href.startsWith('/')) return null;
  return `${readWebBaseUrl()}${scoped(href, orgId)}`;
}

export const ORG_HEADER = 'x-munin-org';

export const ORG_ACCESS_DENIED_CODE = 'org_access_denied';

export const ORG_SCOPE_SEGMENT = '/o/';

export const DASHBOARD_BASE_PATH = '/dashboard';

const ORG_ID_PATTERN = /^org_[0-9a-z]{22}$/;

export function isOrgId(value: string): boolean {
  return ORG_ID_PATTERN.test(value);
}

export interface OrgScopedDashboardPath {
  orgId: string;
  path: string;
}

function splitSuffix(path: string): { pathname: string; suffix: string } {
  const at = path.search(/[?#]/);
  return at < 0
    ? { pathname: path, suffix: '' }
    : { pathname: path.slice(0, at), suffix: path.slice(at) };
}

function isDashboardPath(pathname: string): boolean {
  return pathname === DASHBOARD_BASE_PATH || pathname.startsWith(`${DASHBOARD_BASE_PATH}/`);
}

export function orgDashboardPath(path: string, orgId: string): string {
  const { pathname, suffix } = splitSuffix(path);
  if (!isDashboardPath(pathname) || !isOrgId(orgId)) return path;
  return `${ORG_SCOPE_SEGMENT}${orgId}${pathname}${suffix}`;
}

export function parseOrgDashboardPath(path: string): OrgScopedDashboardPath | null {
  const { pathname, suffix } = splitSuffix(path);
  if (!pathname.startsWith(ORG_SCOPE_SEGMENT)) return null;
  const tail = pathname.slice(ORG_SCOPE_SEGMENT.length);
  const cut = tail.indexOf('/');
  if (cut < 0) return null;
  const orgId = tail.slice(0, cut);
  const rest = tail.slice(cut);
  if (!isOrgId(orgId) || !isDashboardPath(rest)) return null;
  return { orgId, path: `${rest}${suffix}` };
}

export function stripOrgDashboardPath(path: string): string {
  return parseOrgDashboardPath(path)?.path ?? path;
}

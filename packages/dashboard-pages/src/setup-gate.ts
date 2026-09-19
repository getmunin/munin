import { NextResponse, type NextRequest } from 'next/server';
import { isOrgId, orgDashboardPath, parseOrgDashboardPath, ORG_SCOPE_SEGMENT } from '@getmunin/types';
import { signInHrefFor } from './auth/post-signin-redirect';
import { fetchJsonWithCookie } from './auth/api-cookie-fetch';
import {
  isSetupIncomplete,
  type AgentConfigStatusDto,
  type MembershipDto,
} from './auth/setup-status';

export type SetupGateScope = 'root' | 'subtree';

export interface SetupGateOptions {
  locales: readonly string[];
  scope?: SetupGateScope;
  exempt?: readonly string[];
  apiUrl?: string;
  timeoutMs?: number;
  orgScopedRoutes?: boolean;
}

export type MiddlewareHandler = (
  request: NextRequest,
) => NextResponse | Promise<NextResponse>;

const DEFAULT_TIMEOUT_MS = 1500;
const DASHBOARD_SEGMENT = '/dashboard';

export interface SplitPathname {
  localePrefix: string;
  hasLocale: boolean;
  orgId: string | null;
  path: string;
}

export function splitPathname(pathname: string, locales: readonly string[]): SplitPathname {
  const head = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  const locale = head?.[1];
  const hasLocale = locale !== undefined && locales.includes(locale);
  const localePrefix = hasLocale ? `/${locale}` : '';
  const rest = hasLocale ? (head?.[2] ?? '/') : pathname;
  const scoped = parseOrgDashboardPath(rest);
  return scoped
    ? { localePrefix, hasLocale, orgId: scoped.orgId, path: scoped.path }
    : { localePrefix, hasLocale, orgId: null, path: rest };
}

export function splitLocalePrefix(
  pathname: string,
  locales: readonly string[],
): { prefix: string; rest: string } {
  const { localePrefix } = splitPathname(pathname, locales);
  return { prefix: localePrefix, rest: pathname.slice(localePrefix.length) };
}

function isDashboardPath(path: string): boolean {
  return path === DASHBOARD_SEGMENT || path.startsWith(`${DASHBOARD_SEGMENT}/`);
}

function isGatedPath(path: string, options: SetupGateOptions): boolean {
  if ((options.scope ?? 'root') === 'subtree') return isDashboardPath(path);
  return path === DASHBOARD_SEGMENT || path === `${DASHBOARD_SEGMENT}/`;
}

function isExemptPath(path: string, options: SetupGateOptions): boolean {
  const exempt = options.exempt ?? [];
  return exempt.some(
    (e) => path === `${DASHBOARD_SEGMENT}/${e}` || path.startsWith(`${DASHBOARD_SEGMENT}/${e}/`),
  );
}

export function isSetupGatedPath(pathname: string, options: SetupGateOptions): boolean {
  const { hasLocale, path } = splitPathname(pathname, options.locales);
  return hasLocale && isGatedPath(path, options) && !isExemptPath(path, options);
}

export function setupPathFor(pathname: string): string {
  const at = pathname.indexOf(DASHBOARD_SEGMENT);
  if (at < 0) return pathname;
  const prefix = pathname.slice(0, at);
  const org = prefix.lastIndexOf(ORG_SCOPE_SEGMENT);
  const scoped =
    org >= 0 && isOrgId(prefix.slice(org + ORG_SCOPE_SEGMENT.length))
      ? prefix.slice(0, org)
      : prefix;
  return `${scoped}/setup`;
}

export function needsOrgSegment(
  pathname: string,
  locales: readonly string[],
  orgScopedRoutes = true,
): boolean {
  if (!orgScopedRoutes) return false;
  const { hasLocale, orgId, path } = splitPathname(pathname, locales);
  return hasLocale && orgId === null && isDashboardPath(path);
}

export function orgScopedDashboardPathname(
  pathname: string,
  orgId: string,
  locales: readonly string[],
): string | null {
  const split = splitPathname(pathname, locales);
  if (!split.hasLocale || split.orgId !== null || !isDashboardPath(split.path)) return null;
  const scoped = orgDashboardPath(split.path, orgId);
  return scoped === split.path ? null : `${split.localePrefix}${scoped}`;
}

export function defaultOrgId(memberships: MembershipDto[] | null): string | null {
  const active = memberships?.find((m) => m.isDefault) ?? memberships?.[0] ?? null;
  return active?.orgId ?? null;
}

export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.includes('session_token');
}

async function readGateState(
  cookie: string,
  options: SetupGateOptions,
): Promise<{ setupIncomplete: boolean; memberships: MembershipDto[] | null }> {
  const fetchOptions = {
    apiUrl: options.apiUrl,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: 'setup-gate',
  };
  const [config, memberships] = await Promise.all([
    fetchJsonWithCookie<AgentConfigStatusDto>('/v1/agent-config', cookie, fetchOptions),
    fetchJsonWithCookie<MembershipDto[]>('/v1/me/memberships', cookie, fetchOptions),
  ]);
  return { setupIncomplete: isSetupIncomplete(config, memberships), memberships };
}

export async function fetchSetupIncomplete(
  cookie: string,
  options: SetupGateOptions,
): Promise<boolean> {
  return (await readGateState(cookie, options)).setupIncomplete;
}

export function withSetupGate(
  handle: MiddlewareHandler,
  options: SetupGateOptions,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const response = await handle(request);
    if (response.headers.get('location')) return response;

    const { pathname } = request.nextUrl;
    const split = splitPathname(pathname, options.locales);
    if (!split.hasLocale || !isDashboardPath(split.path)) return response;

    const setupGated = isGatedPath(split.path, options) && !isExemptPath(split.path, options);
    const needsOrg = (options.orgScopedRoutes ?? false) && split.orgId === null;
    if (!setupGated && !needsOrg) return response;

    const cookie = request.headers.get('cookie') ?? '';
    if (!hasSessionCookie(cookie)) {
      if (!needsOrg) return response;
      const target = new URL(
        signInHrefFor(`${split.path}${request.nextUrl.search}`),
        request.nextUrl.origin,
      );
      const url = request.nextUrl.clone();
      url.pathname = `${split.localePrefix}${target.pathname}`;
      url.search = target.search;
      return NextResponse.redirect(url);
    }

    const { setupIncomplete, memberships } = await readGateState(cookie, options);
    if (setupGated && setupIncomplete) {
      const url = request.nextUrl.clone();
      url.pathname = setupPathFor(pathname);
      return NextResponse.redirect(url);
    }
    if (!needsOrg) return response;

    const orgId = defaultOrgId(memberships);
    const scoped = orgId ? orgScopedDashboardPathname(pathname, orgId, options.locales) : null;
    if (!scoped) return response;
    const url = request.nextUrl.clone();
    url.pathname = scoped;
    return NextResponse.redirect(url);
  };
}

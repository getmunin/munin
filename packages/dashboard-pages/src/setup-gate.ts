import { NextResponse, type NextRequest } from 'next/server';
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
}

export type MiddlewareHandler = (
  request: NextRequest,
) => NextResponse | Promise<NextResponse>;

const DEFAULT_TIMEOUT_MS = 1500;
const DASHBOARD_SEGMENT = '/dashboard';

function localeGroup(locales: readonly string[]): string {
  return `(?:${locales.join('|')})`;
}

function gatedPattern(options: SetupGateOptions): RegExp {
  const tail = (options.scope ?? 'root') === 'subtree' ? '(?:/.*)?' : '/?';
  return new RegExp(`^/${localeGroup(options.locales)}/dashboard${tail}$`);
}

function exemptPattern(options: SetupGateOptions): RegExp | null {
  const exempt = options.exempt ?? [];
  if (exempt.length === 0) return null;
  return new RegExp(
    `^/${localeGroup(options.locales)}/dashboard/(?:${exempt.join('|')})(?:/.*)?$`,
  );
}

export function isSetupGatedPath(pathname: string, options: SetupGateOptions): boolean {
  if (!gatedPattern(options).test(pathname)) return false;
  const exempt = exemptPattern(options);
  return exempt ? !exempt.test(pathname) : true;
}

export function setupPathFor(pathname: string): string {
  const at = pathname.indexOf(DASHBOARD_SEGMENT);
  return at < 0 ? pathname : `${pathname.slice(0, at)}/setup`;
}

export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.includes('session_token');
}

export async function fetchSetupIncomplete(
  cookie: string,
  options: SetupGateOptions,
): Promise<boolean> {
  const fetchOptions = {
    apiUrl: options.apiUrl,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: 'setup-gate',
  };
  const [config, memberships] = await Promise.all([
    fetchJsonWithCookie<AgentConfigStatusDto>('/v1/agent-config', cookie, fetchOptions),
    fetchJsonWithCookie<MembershipDto[]>('/v1/me/memberships', cookie, fetchOptions),
  ]);
  return isSetupIncomplete(config, memberships);
}

export function withSetupGate(
  handle: MiddlewareHandler,
  options: SetupGateOptions,
): (request: NextRequest) => Promise<NextResponse> {
  const gated = gatedPattern(options);
  const exempt = exemptPattern(options);

  return async (request: NextRequest): Promise<NextResponse> => {
    const response = await handle(request);
    if (response.headers.get('location')) return response;

    const { pathname } = request.nextUrl;
    if (!gated.test(pathname)) return response;
    if (exempt?.test(pathname)) return response;

    const cookie = request.headers.get('cookie') ?? '';
    if (!hasSessionCookie(cookie)) return response;
    if (!(await fetchSetupIncomplete(cookie, options))) return response;

    const url = request.nextUrl.clone();
    url.pathname = setupPathFor(pathname);
    return NextResponse.redirect(url);
  };
}

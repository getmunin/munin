import { NextResponse, type NextRequest } from 'next/server';
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

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function resolveApiUrl(options: SetupGateOptions): string {
  return trimTrailingSlashes(
    options.apiUrl ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  );
}

async function readJson<T>(url: string, cookie: string, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn('[setup-gate] status fetch failed', url, err);
    return null;
  }
}

export async function fetchSetupIncomplete(
  cookie: string,
  options: SetupGateOptions,
): Promise<boolean> {
  const apiUrl = resolveApiUrl(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [config, memberships] = await Promise.all([
    readJson<AgentConfigStatusDto>(`${apiUrl}/v1/agent-config`, cookie, timeoutMs),
    readJson<MembershipDto[]>(`${apiUrl}/v1/me/memberships`, cookie, timeoutMs),
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

import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import {
  hasSessionCookie,
  isSetupGatedPath,
  isSetupIncomplete,
  setupPathFor,
  type AgentConfigStatusDto,
  type MembershipDto,
} from './lib/setup-gate';

const handleIntl = createMiddleware(routing);

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const SETUP_STATUS_TIMEOUT_MS = 1500;

async function fetchWithCookies<T>(path: string, cookie: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(SETUP_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn('[proxy] setup-status fetch failed', path, err);
    return null;
  }
}

async function setupIncompleteFor(cookie: string): Promise<boolean> {
  const [config, memberships] = await Promise.all([
    fetchWithCookies<AgentConfigStatusDto>('/v1/agent-config', cookie),
    fetchWithCookies<MembershipDto[]>('/v1/me/memberships', cookie),
  ]);
  return isSetupIncomplete(config, memberships);
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = handleIntl(request);
  if (response.headers.get('location')) return response;

  const { pathname } = request.nextUrl;
  if (!isSetupGatedPath(pathname)) return response;

  const cookie = request.headers.get('cookie') ?? '';
  if (!hasSessionCookie(cookie)) return response;
  if (!(await setupIncompleteFor(cookie))) return response;

  const url = request.nextUrl.clone();
  url.pathname = setupPathFor(pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

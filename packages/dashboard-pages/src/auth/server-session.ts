import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from '../i18n-navigation';
import { safeRedirect } from './post-signin-redirect';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
}): Promise<void> {
  const session = await getServerSession();
  if (!session) return;
  const raw = Array.isArray(opts.redirectParam) ? opts.redirectParam[0] : opts.redirectParam;
  redirect({ href: safeRedirect(raw ?? null), locale: opts.locale });
}

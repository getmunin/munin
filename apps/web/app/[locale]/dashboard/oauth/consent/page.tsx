import { OAuthConsentPage, type OAuthClientInfo } from '@getmunin/dashboard-pages';
import { redirectIfSetupIncomplete } from '@getmunin/dashboard-pages/server';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

async function fetchClientInfo(clientId: string): Promise<OAuthClientInfo | null> {
  if (!clientId) return null;
  try {
    const res = await fetch(`${API_URL}/v1/oauth/clients/${encodeURIComponent(clientId)}`, {
      // anonymous lookup — no session cookies. Server-to-server, no CORS.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as OAuthClientInfo;
  } catch (err) {
    console.warn('[oauth-consent] server-side client info lookup failed', err);
    return null;
  }
}

export default async function Page({ params, searchParams }: PageProps) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  await redirectIfSetupIncomplete({ locale, searchParams: sp });
  const raw = sp.client_id;
  const clientId = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  const clientInfo = await fetchClientInfo(clientId);
  return <OAuthConsentPage clientInfo={clientInfo} />;
}

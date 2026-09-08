const DEFAULT_TIMEOUT_MS = 1500;

export function resolveApiUrl(apiUrl?: string): string {
  const raw = apiUrl ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  let end = raw.length;
  while (end > 0 && raw[end - 1] === '/') end -= 1;
  return raw.slice(0, end);
}

export async function fetchJsonWithCookie<T>(
  path: string,
  cookie: string,
  options: { apiUrl?: string; timeoutMs?: number; label?: string } = {},
): Promise<T | null> {
  const url = `${resolveApiUrl(options.apiUrl)}${path}`;
  try {
    const res = await fetch(url, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[${options.label ?? 'api-cookie-fetch'}] fetch failed`, path, err);
    return null;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Fetch helper for control-plane endpoints. Sends the BetterAuth session
 * cookie automatically via `credentials: 'include'`; the backend's AuthGuard
 * resolves it to a user-typed actor scoped to that user's org.
 *
 * Throws `ApiError` with a usable message on non-2xx responses so pages can
 * decide between toast vs full-page error.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

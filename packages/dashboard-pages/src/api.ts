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
  readonly status: number;
  readonly statusText: string;
  readonly endpoint: string;
  readonly method: string;
  readonly requestId: string | null;

  constructor(opts: {
    status: number;
    statusText: string;
    endpoint: string;
    method: string;
    requestId: string | null;
    message: string;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.endpoint = opts.endpoint;
    this.method = opts.method;
    this.requestId = opts.requestId;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError({
      status: 0,
      statusText: 'network error',
      endpoint: path,
      method,
      requestId: null,
      message: err instanceof Error ? err.message : 'Network request failed',
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError({
      status: res.status,
      statusText: res.statusText || statusTextForCode(res.status),
      endpoint: path,
      method,
      requestId: res.headers.get('x-request-id'),
      message: parseErrorMessage(text) || `${res.status} ${res.statusText}`,
    });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function parseErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (typeof obj.error === 'string') return obj.error;
    }
  } catch (err) {
    console.warn('[munin/api] error body was not JSON, returning raw text', err);
  }
  return body;
}

function statusTextForCode(code: number): string {
  if (code === 0) return 'network error';
  if (code === 408) return 'request timeout';
  if (code === 502) return 'bad gateway';
  if (code === 503) return 'service unavailable';
  if (code === 504) return 'gateway timeout';
  if (code >= 500) return 'server error';
  if (code === 401) return 'unauthorized';
  if (code === 403) return 'forbidden';
  if (code === 404) return 'not found';
  if (code >= 400) return 'client error';
  return 'error';
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Fetch helper for control-plane endpoints. Sends the BetterAuth session
 * cookie automatically via `credentials: 'include'`; the backend's AuthGuard
 * resolves it to a user-typed actor scoped to that user's org.
 *
 * Throws `ApiError` with a usable message on non-2xx responses so pages can
 * decide between toast vs full-page error.
 */
export interface ApiFieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly endpoint: string;
  readonly method: string;
  readonly requestId: string | null;
  readonly fieldErrors: readonly ApiFieldError[];

  constructor(opts: {
    status: number;
    statusText: string;
    endpoint: string;
    method: string;
    requestId: string | null;
    message: string;
    fieldErrors?: readonly ApiFieldError[];
  }) {
    super(opts.message);
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.endpoint = opts.endpoint;
    this.method = opts.method;
    this.requestId = opts.requestId;
    this.fieldErrors = opts.fieldErrors ?? [];
  }
}

export interface ApiOptions extends RequestInit {
  /** Don't send the BetterAuth session cookie. For `@PublicController` endpoints
   *  that would otherwise trip the credentials-mode CORS preflight check. */
  anonymous?: boolean;
}

export async function api<T>(path: string, init: ApiOptions = {}): Promise<T> {
  const { anonymous, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      credentials: anonymous ? 'omit' : 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(rest.headers ?? {}),
      },
    });
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.debug('[munin/api] network error', { path, method, err });
    }
    throw new ApiError({
      status: 0,
      statusText: 'network error',
      endpoint: path,
      method,
      requestId: null,
      message: "Couldn't reach Munin. Check your connection.",
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const parsed = parseErrorBody(text);
    throw new ApiError({
      status: res.status,
      statusText: res.statusText || statusTextForCode(res.status),
      endpoint: path,
      method,
      requestId: res.headers.get('x-request-id'),
      message: parsed.message || `${res.status} ${res.statusText}`,
      fieldErrors: parsed.fieldErrors,
    });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function parseErrorBody(body: string): { message: string | null; fieldErrors: ApiFieldError[] } {
  if (!body) return { message: null, fieldErrors: [] };
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const fieldErrors = readFieldErrors(obj);
      const message =
        typeof obj.message === 'string'
          ? obj.message
          : typeof obj.error === 'string'
          ? obj.error
          : null;
      return { message, fieldErrors };
    }
  } catch (err) {
    console.warn('[munin/api] error body was not JSON, returning raw text', err);
  }
  return { message: body, fieldErrors: [] };
}

function readFieldErrors(obj: Record<string, unknown>): ApiFieldError[] {
  const raw = obj.fieldErrors;
  if (!Array.isArray(raw)) return [];
  const out: ApiFieldError[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.field === 'string' && typeof e.message === 'string') {
      out.push({ field: e.field, message: e.message });
    }
  }
  return out;
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

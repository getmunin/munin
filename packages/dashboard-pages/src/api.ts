import { ORG_ACCESS_DENIED_CODE, ORG_HEADER } from '@getmunin/types';
import { clearActiveOrgId, getActiveOrgId, setActiveOrgId } from './auth/active-org';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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
  readonly code: string | null;

  constructor(opts: {
    status: number;
    statusText: string;
    endpoint: string;
    method: string;
    requestId: string | null;
    message: string;
    fieldErrors?: readonly ApiFieldError[];
    code?: string | null;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.endpoint = opts.endpoint;
    this.method = opts.method;
    this.requestId = opts.requestId;
    this.fieldErrors = opts.fieldErrors ?? [];
    this.code = opts.code ?? null;
  }
}

export interface ApiOptions extends RequestInit {
  anonymous?: boolean;
}

export async function api<T>(path: string, init: ApiOptions = {}): Promise<T> {
  const { anonymous, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const requestedOrgId = anonymous ? null : getActiveOrgId();
  let res: Response;
  try {
    res = await sendRequest(path, rest, anonymous, requestedOrgId);
    if (requestedOrgId && (await isOrgAccessDenied(res))) {
      clearActiveOrgId();
      res = await sendRequest(path, rest, anonymous, null);
    }
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
      code: 'NETWORK_ERROR',
    });
  }
  if (!anonymous) reconcileServingOrg(res, getActiveOrgId());

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
      code: parsed.code,
    });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function sendRequest(
  path: string,
  rest: RequestInit,
  anonymous: boolean | undefined,
  orgId: string | null,
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: anonymous ? 'omit' : 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(orgId ? { [ORG_HEADER]: orgId } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

async function isOrgAccessDenied(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const text = await res
    .clone()
    .text()
    .catch(() => '');
  return parseErrorBody(text).code === ORG_ACCESS_DENIED_CODE;
}

function reconcileServingOrg(res: Response, requestedOrgId: string | null): void {
  const servingOrgId = res.headers.get(ORG_HEADER)?.trim();
  if (!servingOrgId) return;
  if (!requestedOrgId) {
    setActiveOrgId(servingOrgId);
    return;
  }
  if (servingOrgId === requestedOrgId) return;
  console.warn('[munin/api] served a different org than requested', {
    requestedOrgId,
    servingOrgId,
  });
  setActiveOrgId(servingOrgId);
}

function parseErrorBody(body: string): {
  message: string | null;
  fieldErrors: ApiFieldError[];
  code: string | null;
} {
  if (!body) return { message: null, fieldErrors: [], code: null };
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
      const code = typeof obj.code === 'string' ? obj.code : null;
      return { message, fieldErrors, code };
    }
  } catch (err) {
    console.warn('[munin/api] error body was not JSON, returning raw text', err);
  }
  return { message: body, fieldErrors: [], code: null };
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

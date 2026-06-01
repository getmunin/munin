import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

interface BetterAuthLike {
  handler: (req: globalThis.Request) => Promise<globalThis.Response>;
}

/**
 * Marshal an Express request → Fetch Request, hand it to a BetterAuth-like
 * `handler`, then pipe the Fetch Response back to Express. This is the only
 * boilerplate the OSS and cloud auth controllers actually share — each
 * edition wraps it with its own controller class so Nest decorators can
 * mount the routes at `@Controller('auth')`.
 */
export async function handleAuthRequest(
  auth: BetterAuthLike,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> {
  const fetchRequest = expressRequestToFetch(req);
  const fetchResponse = await auth.handler(fetchRequest);
  await pipeFetchResponseToExpress(fetchResponse, res);
}

export function requireAuthSecret(): string {
  const secret = process.env.MUNIN_AUTH_SECRET;
  if (!secret) throw new Error('MUNIN_AUTH_SECRET is required');
  assertProductionAuthSecret(secret);
  return secret;
}

export function assertProductionAuthSecret(secret: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (secret.length < 32) {
    throw new Error(
      'MUNIN_AUTH_SECRET must be at least 32 characters in production. Generate one with `openssl rand -base64 48`.',
    );
  }
  if (isPlaceholderSecret(secret)) {
    throw new Error(
      'MUNIN_AUTH_SECRET looks like a placeholder/dev value. Generate a real secret with `openssl rand -base64 48`.',
    );
  }
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^replace[-_]?me/i,
  /^dev[-_]?secret/i,
  /^test[-_]?secret/i,
  /^changeme/i,
  /do[-_]?not[-_]?use/i,
  /^(?:[a-z]+|x+|0+)$/i,
];

function isPlaceholderSecret(secret: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(secret));
}

function expressRequestToFetch(req: ExpressRequest): globalThis.Request {
  const protocol = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
  const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
  const url = `${protocol}://${host}${req.originalUrl}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (typeof value === 'string') headers.set(name, value);
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const rawBody = (req as ExpressRequest & { rawBody?: Buffer }).rawBody;
    if (rawBody && rawBody.length > 0) {
      init.body = new Uint8Array(rawBody);
    } else {
      const body: unknown = req.body;
      if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        init.body = JSON.stringify(body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }
  }
  return new globalThis.Request(url, init);
}

async function pipeFetchResponseToExpress(
  fetchResponse: globalThis.Response,
  res: ExpressResponse,
): Promise<void> {
  res.status(fetchResponse.status);
  fetchResponse.headers.forEach((value: string, name: string) => {
    res.setHeader(name, value);
  });
  const body = await fetchResponse.text();
  res.send(body);
}

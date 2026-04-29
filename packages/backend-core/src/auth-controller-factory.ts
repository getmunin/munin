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
  return secret;
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
    init.body = JSON.stringify(req.body ?? {});
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
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

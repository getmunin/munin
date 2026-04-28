import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { Db } from '@munin/db';
import { DB } from '../common/db/db.module.js';
import { createMuninAuth, readGoogleProviderFromEnv, type MuninAuth } from './auth.config.js';

const PUBLIC_URL_FALLBACK = 'http://localhost:3001';

@Controller('auth')
export class AuthController {
  private readonly auth: MuninAuth;

  constructor(@Inject(DB) db: Db) {
    this.auth = createMuninAuth({
      db,
      baseUrl: process.env.MUNIN_PUBLIC_URL ?? PUBLIC_URL_FALLBACK,
      authSecret: requireAuthSecret(),
      google: readGoogleProviderFromEnv(),
    });
  }

  @All(':rest(.*)')
  async handle(@Req() req: ExpressRequest, @Res() res: ExpressResponse): Promise<void> {
    const fetchRequest = expressRequestToFetch(req);
    const fetchResponse = await this.auth.handler(fetchRequest);
    await pipeFetchResponseToExpress(fetchResponse, res);
  }
}

function requireAuthSecret(): string {
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

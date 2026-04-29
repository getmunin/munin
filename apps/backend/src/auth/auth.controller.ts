import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { Db } from '@getmunin/db';
import { readMailerFromEnv } from '@getmunin/core';
import {
  DB,
  handleAuthRequest,
  readGoogleProviderFromEnv,
  readTrustedOriginsFromEnv,
  requireAuthSecret,
} from '@getmunin/backend-core';
import {
  createMuninAuth,
  readAllowedEmailDomainsFromEnv,
  type MuninAuth,
} from './auth.config.js';

const PUBLIC_URL_FALLBACK = 'http://localhost:3001';

@Controller('auth')
export class AuthController {
  private readonly auth: MuninAuth;

  constructor(@Inject(DB) db: Db) {
    const mailer = readMailerFromEnv();
    this.auth = createMuninAuth({
      db,
      baseUrl: process.env.MUNIN_PUBLIC_URL ?? PUBLIC_URL_FALLBACK,
      authSecret: requireAuthSecret(),
      trustedOrigins: readTrustedOriginsFromEnv(),
      google: readGoogleProviderFromEnv(),
      mailer,
      webBaseUrl: process.env.MUNIN_WEB_URL,
      allowedEmailDomains: readAllowedEmailDomainsFromEnv(),
    });
  }

  @All('*rest')
  async handle(@Req() req: ExpressRequest, @Res() res: ExpressResponse): Promise<void> {
    await handleAuthRequest(this.auth, req, res);
  }
}

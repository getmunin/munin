import { All, Inject, Req, Res } from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { Db } from '@getmunin/db';
import { readMailerFromEnv } from '@getmunin/core';
import {
  DB,
  PublicController,
  handleAuthRequest,
  readGithubProviderFromEnv,
  readGoogleProviderFromEnv,
  readTrustedOriginsFromEnv,
  readTurnstileCaptchaFromEnv,
  requireAuthSecret,
} from '@getmunin/backend-core';
import * as Sentry from '@sentry/nestjs';
import {
  createMuninAuth,
  readAllowedEmailDomainsFromEnv,
  sentryForwardingLogger,
  type MuninAuth,
} from './auth.config.ts';

const AUTH_URL_FALLBACK = 'http://localhost:3001';

@PublicController('auth', { throttle: true })
export class AuthController {
  private readonly auth: MuninAuth;

  constructor(@Inject(DB) db: Db) {
    const mailer = readMailerFromEnv();
    const captcha = readTurnstileCaptchaFromEnv();
    this.auth = createMuninAuth({
      db,
      baseUrl:
        process.env.NEXT_PUBLIC_AUTH_URL ??
        process.env.NEXT_PUBLIC_MCP_URL ??
        AUTH_URL_FALLBACK,
      authSecret: requireAuthSecret(),
      trustedOrigins: readTrustedOriginsFromEnv(),
      mailer,
      webBaseUrl: process.env.MUNIN_WEB_URL,
      allowedEmailDomains: readAllowedEmailDomainsFromEnv(),
      google: readGoogleProviderFromEnv(),
      github: readGithubProviderFromEnv(),
      captcha: captcha
        ? { provider: captcha.provider, secretKey: captcha.secretKey }
        : undefined,
      logger: sentryForwardingLogger(Sentry.captureException),
    });
  }

  @All('*rest')
  async handle(@Req() req: ExpressRequest, @Res() res: ExpressResponse): Promise<void> {
    await handleAuthRequest(this.auth, req, res);
  }
}

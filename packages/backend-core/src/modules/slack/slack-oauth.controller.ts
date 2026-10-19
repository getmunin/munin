import { Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PublicController } from '../../common/auth/auth.guard.ts';
import { readSessionCookie } from '../../auth/auth-cookies.ts';
import {
  SlackInstallRefusedError,
  SlackService,
  SLACK_INSTALL_NONCE_COOKIE,
  SLACK_INSTALL_NONCE_MAX_AGE_MS,
} from './slack.service.ts';
import { readWebBaseUrl } from './slack.constants.ts';

const NONCE_COOKIE_PATH = '/v1/slack/oauth';

const StartQuery = z.object({
  ticket: z.string().min(1).max(4096).optional(),
});

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().optional(),
});

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function integrationsTarget(outcome: string): string {
  return `${readWebBaseUrl()}/dashboard/settings/integrations?slack=${outcome}`;
}

function refusalOutcome(err: unknown): string {
  return err instanceof SlackInstallRefusedError ? err.reason : 'error';
}

@PublicController('v1/slack/oauth')
export class SlackOAuthController {
  constructor(private readonly slack: SlackService) {}

  @Get('start')
  async start(
    @Query() query: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = StartQuery.safeParse(query);
    try {
      const begun = await this.slack.beginInstall({
        ticket: parsed.success ? parsed.data.ticket : undefined,
        sessionToken: readSessionCookie(req.headers.cookie),
      });
      res.cookie(SLACK_INSTALL_NONCE_COOKIE, begun.sessionNonce, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: NONCE_COOKIE_PATH,
        maxAge: SLACK_INSTALL_NONCE_MAX_AGE_MS,
      });
      res.redirect(begun.url);
    } catch (err) {
      res.redirect(integrationsTarget(refusalOutcome(err)));
    }
  }

  @Get('callback')
  async callback(
    @Query() query: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.clearCookie(SLACK_INSTALL_NONCE_COOKIE, { path: NONCE_COOKIE_PATH });
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      res.redirect(integrationsTarget(q?.error === 'access_denied' ? 'denied' : 'error'));
      return;
    }
    try {
      await this.slack.completeInstall({
        code: q.code,
        state: q.state,
        sessionNonce: readCookie(req.headers.cookie, SLACK_INSTALL_NONCE_COOKIE),
        sessionToken: readSessionCookie(req.headers.cookie),
      });
      res.redirect(integrationsTarget('connected'));
    } catch (err) {
      res.redirect(integrationsTarget(refusalOutcome(err)));
    }
  }
}

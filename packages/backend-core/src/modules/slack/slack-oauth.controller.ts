import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SlackService, SLACK_INSTALL_NONCE_COOKIE } from './slack.service.ts';
import { readWebBaseUrl } from './slack.constants.ts';

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

/**
 * Public landing for Slack's OAuth redirect. The org and installing user
 * travel in the HMAC-signed `state` minted by SlackService.installUrl().
 * Dashboard-initiated installs also carry a nonce bound to the
 * `slack_install_nonce` cookie set on the same browser, which the service
 * checks. Always redirects back to the dashboard AI settings page with a
 * `slack=` outcome flag.
 */
@Controller('v1/slack/oauth')
export class SlackOAuthController {
  constructor(private readonly slack: SlackService) {}

  @Get('callback')
  async callback(
    @Query() query: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/integrations`;
    res.clearCookie(SLACK_INSTALL_NONCE_COOKIE, { path: '/v1/slack/oauth' });
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      res.redirect(`${target}?slack=${q?.error === 'access_denied' ? 'denied' : 'error'}`);
      return;
    }
    try {
      await this.slack.completeInstall({
        code: q.code,
        state: q.state,
        sessionNonce: readCookie(req.headers.cookie, SLACK_INSTALL_NONCE_COOKIE),
      });
      res.redirect(`${target}?slack=connected`);
    } catch {
      res.redirect(`${target}?slack=error`);
    }
  }
}

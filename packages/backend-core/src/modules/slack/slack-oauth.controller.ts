import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SlackService } from './slack.service.ts';
import { readWebBaseUrl } from './slack.constants.ts';

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().optional(),
});

/**
 * Public landing for Slack's OAuth redirect — the org and installing user
 * travel in the HMAC-signed `state` minted by SlackService.installUrl(), so
 * no session is required here. Always redirects back to the dashboard's AI
 * settings page with a `slack=` outcome flag.
 */
@Controller('v1/slack/oauth')
export class SlackOAuthController {
  constructor(private readonly slack: SlackService) {}

  @Get('callback')
  async callback(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/ai`;
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      res.redirect(`${target}?slack=${q?.error === 'access_denied' ? 'denied' : 'error'}`);
      return;
    }
    try {
      await this.slack.completeInstall({ code: q.code, state: q.state });
      res.redirect(`${target}?slack=connected`);
    } catch {
      res.redirect(`${target}?slack=error`);
    }
  }
}

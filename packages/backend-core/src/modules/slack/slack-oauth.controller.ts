import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SlackService } from './slack.service.ts';
import { readWebBaseUrl } from './slack.constants.ts';

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
  async callback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/ai`;
    if (
      error !== undefined ||
      typeof code !== 'string' ||
      code.length === 0 ||
      typeof state !== 'string' ||
      state.length === 0
    ) {
      res.redirect(`${target}?slack=${error === 'access_denied' ? 'denied' : 'error'}`);
      return;
    }
    try {
      await this.slack.completeInstall({ code, state });
      res.redirect(`${target}?slack=connected`);
    } catch {
      res.redirect(`${target}?slack=error`);
    }
  }
}

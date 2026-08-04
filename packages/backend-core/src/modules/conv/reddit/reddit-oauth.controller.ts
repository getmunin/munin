import { Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PublicController } from '../../../common/auth/auth.guard.ts';
import { readWebBaseUrl } from '../../slack/slack.constants.ts';
import { RedditService } from './reddit.service.ts';

const CallbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});

function statusFor(message: string): string {
  if (message.includes('reddit_account_mismatch')) return 'mismatch';
  if (message.includes('reddit_missing_scopes')) return 'scopes';
  return 'error';
}

@PublicController('v1/conversations/channels/reddit/oauth')
export class RedditOAuthController {
  constructor(private readonly reddit: RedditService) {}

  @Get('callback')
  async callback(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/channels`;
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      res.redirect(`${target}?reddit=${q?.error === 'access_denied' ? 'denied' : 'error'}`);
      return;
    }
    try {
      await this.reddit.completeOAuth({ code: q.code, state: q.state });
      res.redirect(`${target}?reddit=connected`);
    } catch (err) {
      res.redirect(`${target}?reddit=${statusFor(err instanceof Error ? err.message : '')}`);
    }
  }
}

import { Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PublicController } from '../../common/auth/auth.guard.ts';
import { readWebBaseUrl } from '../credential-handoff/credential-handoff.constants.ts';
import { SocialAccountsService } from './social-accounts.service.ts';

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().optional(),
});

@PublicController('v1/social/oauth')
export class SocialOAuthController {
  constructor(private readonly accounts: SocialAccountsService) {}

  @Get('callback')
  async callback(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/integrations`;
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      res.redirect(`${target}?social=${q?.error === 'user_cancelled_authorize' || q?.error === 'access_denied' ? 'denied' : 'error'}`);
      return;
    }
    try {
      const { platform } = await this.accounts.completeAuthorization({
        code: q.code,
        state: q.state,
      });
      res.redirect(`${target}?social=connected&platform=${encodeURIComponent(platform)}`);
    } catch {
      res.redirect(`${target}?social=error`);
    }
  }
}

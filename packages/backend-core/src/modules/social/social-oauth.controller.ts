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
  error_description: z.string().max(2048).optional(),
});

function isPrintable(char: string): boolean {
  const code = char.charCodeAt(0);
  return code > 31 && code !== 127;
}

export function readableReason(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = [...raw.replace(/&quot;/g, '"').replace(/\+/g, ' ')]
    .map((char) => (isPrintable(char) ? char : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : null;
}

@PublicController('v1/social/oauth')
export class SocialOAuthController {
  constructor(private readonly accounts: SocialAccountsService) {}

  @Get('callback')
  async callback(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/integrations`;
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      const denied = q?.error === 'user_cancelled_authorize' || q?.error === 'access_denied';
      res.redirect(`${target}?social=${denied ? 'denied' : 'error'}${reasonParam(q?.error_description)}`);
      return;
    }
    try {
      const { platform } = await this.accounts.completeAuthorization({
        code: q.code,
        state: q.state,
      });
      res.redirect(`${target}?social=connected&platform=${encodeURIComponent(platform)}`);
    } catch (err) {
      res.redirect(`${target}?social=error${reasonParam(err instanceof Error ? err.message : undefined)}`);
    }
  }
}

function reasonParam(raw: string | undefined): string {
  const reason = readableReason(raw);
  return reason ? `&reason=${encodeURIComponent(reason)}` : '';
}

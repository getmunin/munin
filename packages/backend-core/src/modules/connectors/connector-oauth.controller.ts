import { Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PublicController } from '../../common/auth/auth.guard.ts';
import { readWebBaseUrl } from '../credential-handoff/credential-handoff.constants.ts';
import { ConnectorOAuthService } from './connector-oauth.service.ts';

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().optional(),
});

@PublicController('v1/connectors/oauth')
export class ConnectorOAuthController {
  constructor(private readonly oauth: ConnectorOAuthService) {}

  @Get('callback')
  async callback(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const target = `${readWebBaseUrl()}/dashboard/settings/integrations`;
    const parsed = CallbackQuery.safeParse(query);
    const q = parsed.success ? parsed.data : null;
    if (!q || q.error || !q.code || !q.state) {
      res.redirect(`${target}?connector=${q?.error === 'access_denied' ? 'denied' : 'error'}`);
      return;
    }
    try {
      const { vendor } = await this.oauth.completeAuthorization({ code: q.code, state: q.state });
      res.redirect(`${target}?connector=connected&vendor=${encodeURIComponent(vendor)}`);
    } catch {
      res.redirect(`${target}?connector=error`);
    }
  }
}

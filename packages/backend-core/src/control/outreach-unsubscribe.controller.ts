import { BadRequestException, Body, Get, Headers, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicController } from '../common/auth/auth.guard.ts';
import {
  OutreachUnsubscribeService,
  type UnsubscribeMethod,
} from '../modules/outreach/outreach-unsubscribe.service.ts';
import { pickUnsubscribeLocale, renderUnsubscribePage } from './outreach-unsubscribe.page.ts';

interface UnsubscribeJson {
  ok: boolean;
  alreadyUnsubscribed: boolean;
  contactFound: boolean;
}

@PublicController('v1/outreach/unsubscribe')
export class OutreachUnsubscribeController {
  constructor(
    @Inject(OutreachUnsubscribeService) private readonly unsubscribes: OutreachUnsubscribeService,
  ) {}

  @Get()
  async page(
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('token') token?: string,
  ): Promise<string> {
    const view = await this.unsubscribes.inspect(token);
    sendAsPage(res, view.state === 'invalid' ? 400 : 200);
    return renderUnsubscribePage({
      view: view.state,
      locale: pickUnsubscribeLocale(acceptLanguage),
      orgName: view.orgName,
      token: token ?? null,
    });
  }

  @Post()
  @HttpCode(200)
  async unsubscribe(
    @Body() body: Record<string, unknown> | undefined,
    @Headers('accept') accept: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('token') queryToken?: string,
  ): Promise<string | UnsubscribeJson> {
    const bodyToken = typeof body?.['token'] === 'string' ? body['token'] : undefined;
    const token = queryToken ?? bodyToken;
    const result = await this.unsubscribes.unsubscribe(token, unsubscribeMethod(body, contentType));

    if (!accept?.includes('text/html')) {
      if (result.state === 'invalid') {
        throw new BadRequestException('unsubscribe_token_invalid: missing or invalid token');
      }
      return {
        ok: true,
        alreadyUnsubscribed: result.alreadyUnsubscribed,
        contactFound: result.state !== 'not_found',
      };
    }

    sendAsPage(res, result.state === 'invalid' ? 400 : 200);
    return renderUnsubscribePage({
      view: result.state === 'unsubscribed' && !result.alreadyUnsubscribed ? 'done' : result.state,
      locale: pickUnsubscribeLocale(acceptLanguage),
      orgName: result.orgName,
      token: null,
    });
  }
}

function sendAsPage(res: Response, status: number): void {
  res.status(status);
  res.type('html');
  res.setHeader('Cache-Control', 'no-store');
}

function unsubscribeMethod(
  body: Record<string, unknown> | undefined,
  contentType: string | undefined,
): UnsubscribeMethod {
  if (body?.['List-Unsubscribe'] === 'One-Click') return 'one_click';
  if (contentType?.toLowerCase().startsWith('multipart/form-data')) return 'one_click';
  return 'page';
}

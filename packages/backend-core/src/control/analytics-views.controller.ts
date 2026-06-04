import {
  Body,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ViewTokenError, looksLikeBot, verifyViewToken } from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { AnalyticsService } from '../modules/analytics/analytics.service.ts';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

interface BeaconBody {
  token?: string;
  path?: string;
  referrer?: string;
  visitorId?: string;
  locale?: string;
  dwellMs?: number;
  readDepth?: number;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
  metadata?: Record<string, unknown>;
}

@PublicController('v1/a/v', { throttle: true })
export class AnalyticsViewsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get(':token.gif')
  async pixel(
    @Param('token') token: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    sendPixel(res);
    if (looksLikeBot(userAgent)) return;
    if (!token) return;

    let payload;
    try {
      payload = verifyViewToken(token);
    } catch (err) {
      if (err instanceof ViewTokenError) return;
      throw err;
    }

    await this.analytics.recordView({
      orgId: payload.orgId,
      subjectType: payload.subjectType,
      subjectId: payload.subjectId,
      source: 'pixel',
      referrer: referer ?? null,
      userAgentClass: 'browser',
    });
  }

  @Post()
  @HttpCode(204)
  async beacon(
    @Body() body: BeaconBody,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
  ): Promise<void> {
    if (looksLikeBot(userAgent)) return;
    if (!body || typeof body.token !== 'string') return;

    let payload;
    try {
      payload = verifyViewToken(body.token);
    } catch (err) {
      if (err instanceof ViewTokenError) return;
      throw err;
    }

    await this.analytics.recordView({
      orgId: payload.orgId,
      subjectType: payload.subjectType,
      subjectId: payload.subjectId,
      source: 'beacon',
      path: body.path ?? null,
      locale: body.locale ?? null,
      referrer: body.referrer ?? referer ?? null,
      visitorId: body.visitorId ?? null,
      dwellMs: typeof body.dwellMs === 'number' ? body.dwellMs : null,
      readDepth: typeof body.readDepth === 'number' ? body.readDepth : null,
      utmSource: body.utm?.source ?? null,
      utmMedium: body.utm?.medium ?? null,
      utmCampaign: body.utm?.campaign ?? null,
      userAgentClass: 'sdk',
      metadata: body.metadata ?? null,
    });
  }
}

function sendPixel(res: Response): void {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(TRANSPARENT_GIF.length));
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).end(TRANSPARENT_GIF);
}

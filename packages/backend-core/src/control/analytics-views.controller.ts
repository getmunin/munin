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
import { z } from 'zod';
import { ViewTokenError, looksLikeBot, verifyViewToken } from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { AnalyticsService } from '../modules/analytics/analytics.service.ts';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

const BeaconBodySchema = z.object({
  token: z.string(),
  path: z.string().max(512).optional(),
  referrer: z.string().max(512).optional(),
  visitorId: z.string().max(64).optional(),
  locale: z.string().max(16).optional(),
  dwellMs: z.number().int().min(0).optional(),
  readDepth: z.number().int().min(0).max(100).optional(),
  utm: z
    .object({
      source: z.string().max(128).optional(),
      medium: z.string().max(128).optional(),
      campaign: z.string().max(128).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
    @Body() rawBody: unknown,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
  ): Promise<void> {
    if (looksLikeBot(userAgent)) return;
    const parsed = BeaconBodySchema.safeParse(rawBody);
    if (!parsed.success) return;
    const body = parsed.data;

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
      dwellMs: body.dwellMs ?? null,
      readDepth: body.readDepth ?? null,
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

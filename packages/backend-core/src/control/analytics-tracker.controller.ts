import {
  Body,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { hashSecret, isWellFormedKey, keyPrefix, looksLikeBot } from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { AnalyticsService } from '../modules/analytics/analytics.service.ts';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

const DEFAULT_SUBJECT_TYPE = 'page';

interface TrackerBeaconBody {
  key?: string;
  subjectType?: string;
  subjectId?: string;
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

@PublicController('v1/a', { throttle: true })
export class AnalyticsTrackerController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  @Get('t/:key.gif')
  async trackerPixel(
    @Param('key') key: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
    @Query('s') subjectId: string | undefined,
    @Query('t') subjectType: string | undefined,
    @Query('v') visitorId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    sendPixel(res);
    if (looksLikeBot(userAgent)) return;
    if (!subjectId) return;
    const cred = await this.resolveTrackerKey(key);
    if (!cred) return;

    await this.analytics.recordView({
      orgId: cred.orgId,
      subjectType: subjectType || DEFAULT_SUBJECT_TYPE,
      subjectId,
      source: 'tracker',
      referrer: referer ?? null,
      visitorId: visitorId ?? null,
      userAgentClass: 'browser',
    });
  }

  @Post('t')
  @HttpCode(204)
  async trackerBeacon(
    @Body() body: TrackerBeaconBody,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
  ): Promise<void> {
    if (looksLikeBot(userAgent)) return;
    if (!body || typeof body.key !== 'string' || typeof body.subjectId !== 'string') return;
    const cred = await this.resolveTrackerKey(body.key);
    if (!cred) return;

    await this.analytics.recordView({
      orgId: cred.orgId,
      subjectType: body.subjectType || DEFAULT_SUBJECT_TYPE,
      subjectId: body.subjectId,
      source: 'tracker',
      path: body.path ?? null,
      locale: body.locale ?? null,
      referrer: body.referrer ?? referer ?? null,
      visitorId: body.visitorId ?? null,
      dwellMs: typeof body.dwellMs === 'number' ? body.dwellMs : null,
      readDepth: typeof body.readDepth === 'number' ? body.readDepth : null,
      utmSource: body.utm?.source ?? null,
      utmMedium: body.utm?.medium ?? null,
      utmCampaign: body.utm?.campaign ?? null,
      userAgentClass: 'tracker',
      metadata: body.metadata ?? null,
    });
  }

  private async resolveTrackerKey(rawKey: string): Promise<{ orgId: string; id: string } | null> {
    if (!rawKey || !isWellFormedKey(rawKey) || !rawKey.startsWith('mn_track_')) return null;
    try {
      const rows = await this.db
        .select({ id: schema.apiKeys.id, orgId: schema.apiKeys.orgId })
        .from(schema.apiKeys)
        .where(
          and(
            eq(schema.apiKeys.keyPrefix, keyPrefix(rawKey)),
            eq(schema.apiKeys.keyHash, hashSecret(rawKey)),
            eq(schema.apiKeys.type, 'track'),
            isNull(schema.apiKeys.revokedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row || !row.orgId) return null;
      void this.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, row.id))
        .then(undefined, () => undefined);
      return { id: row.id, orgId: row.orgId };
    } catch {
      return null;
    }
  }
}

function sendPixel(res: Response): void {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(TRANSPARENT_GIF.length));
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).end(TRANSPARENT_GIF);
}


import {
  Body,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { hashSecret, isWellFormedKey, keyPrefix, looksLikeBot } from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { AnalyticsService } from '../modules/analytics/analytics.service.ts';
import { GeoIpService } from '../modules/analytics/geoip.service.ts';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

const DEFAULT_SUBJECT_TYPE = 'page';

const PixelQuerySchema = z.object({
  s: z.string().min(1).max(512),
  t: z.string().min(1).max(32).optional(),
  v: z.string().min(1).max(64).optional(),
});

const BeaconBodySchema = z.object({
  key: z.string(),
  subjectType: z.string().min(1).max(32).optional(),
  subjectId: z.string().min(1).max(512),
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

interface ResolvedTracker {
  trackerId: string;
  orgId: string;
  apiKeyId: string;
  allowedOrigins: string[];
}

@PublicController('v1/a', { throttle: true })
export class AnalyticsTrackerController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(GeoIpService) private readonly geoip: GeoIpService,
  ) {}

  @Get('t/:key.gif')
  async trackerPixel(
    @Param('key') key: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Query() rawQuery: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    sendPixel(res);
    if (looksLikeBot(userAgent)) return;
    const parsed = PixelQuerySchema.safeParse(rawQuery);
    if (!parsed.success) return;
    const { s: subjectId, t: subjectType, v: visitorId } = parsed.data;
    const tracker = await this.resolveTrackerKey(key);
    if (!tracker) return;
    if (!originIsAllowed(tracker.allowedOrigins, origin)) return;

    await this.analytics.recordView({
      orgId: tracker.orgId,
      subjectType: subjectType ?? DEFAULT_SUBJECT_TYPE,
      subjectId,
      source: 'tracker',
      referrer: referer ?? null,
      visitorId: visitorId ?? null,
      userAgentClass: 'browser',
      country: this.geoip.lookupCountry(req.ip),
    });
  }

  @Post('t')
  @HttpCode(204)
  async trackerBeacon(
    @Body() rawBody: unknown,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Req() req: Request,
  ): Promise<void> {
    if (looksLikeBot(userAgent)) return;
    const parsed = BeaconBodySchema.safeParse(rawBody);
    if (!parsed.success) return;
    const body = parsed.data;
    const tracker = await this.resolveTrackerKey(body.key);
    if (!tracker) return;
    if (!originIsAllowed(tracker.allowedOrigins, origin)) return;

    await this.analytics.recordView({
      orgId: tracker.orgId,
      subjectType: body.subjectType ?? DEFAULT_SUBJECT_TYPE,
      subjectId: body.subjectId,
      source: 'tracker',
      path: body.path ?? null,
      locale: body.locale ?? null,
      referrer: body.referrer ?? referer ?? null,
      visitorId: body.visitorId ?? null,
      dwellMs: body.dwellMs ?? null,
      readDepth: body.readDepth ?? null,
      utmSource: body.utm?.source ?? null,
      utmMedium: body.utm?.medium ?? null,
      utmCampaign: body.utm?.campaign ?? null,
      userAgentClass: 'tracker',
      country: this.geoip.lookupCountry(req.ip),
      metadata: body.metadata ?? null,
    });
  }

  private async resolveTrackerKey(rawKey: string): Promise<ResolvedTracker | null> {
    if (!rawKey || !isWellFormedKey(rawKey) || !rawKey.startsWith('mn_track_')) return null;
    try {
      const rows = await this.db
        .select({
          apiKeyId: schema.apiKeys.id,
          orgId: schema.apiKeys.orgId,
          trackerId: schema.analyticsTrackers.id,
          allowedOrigins: schema.analyticsTrackers.allowedOrigins,
        })
        .from(schema.apiKeys)
        .innerJoin(
          schema.analyticsTrackers,
          eq(schema.apiKeys.trackerId, schema.analyticsTrackers.id),
        )
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
        .where(eq(schema.apiKeys.id, row.apiKeyId))
        .then(undefined, () => undefined);
      return {
        trackerId: row.trackerId,
        orgId: row.orgId,
        apiKeyId: row.apiKeyId,
        allowedOrigins: row.allowedOrigins,
      };
    } catch {
      return null;
    }
  }
}

export function originIsAllowed(
  allowedOrigins: readonly string[],
  origin: string | undefined,
): boolean {
  const list = allowedOrigins ?? [];
  if (list.length === 0) {
    return !requireTrackerAllowlist();
  }
  if (!origin) return false;
  let viewerOrigin: string;
  try {
    viewerOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  return list.some((entry) => {
    try {
      return new URL(entry).origin === viewerOrigin;
    } catch {
      return false;
    }
  });
}

function requireTrackerAllowlist(): boolean {
  const raw = process.env.MUNIN_TRACKER_REQUIRE_ALLOWLIST?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

function sendPixel(res: Response): void {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(TRANSPARENT_GIF.length));
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).end(TRANSPARENT_GIF);
}

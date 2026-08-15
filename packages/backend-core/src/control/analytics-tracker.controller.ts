import {
  Body,
  Get,
  HttpCode,
  Headers,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  hashSecret,
  identityHashPayload,
  isWellFormedKey,
  keyPrefix,
  legacyIdentityHashPayload,
  looksLikeBot,
  parseEnvBool,
  verifyHmac,
} from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { AnalyticsService } from '../modules/analytics/analytics.service.ts';
import { canonicalizeSubjectId } from '../modules/analytics/canonical-subject.ts';
import { GeoIpService } from '../modules/analytics/geoip.service.ts';
import {
  linkVisitorToEndUser,
  normalizeIdentityEmail,
  resolveIdentifiedEndUser,
} from '../modules/analytics/visitor-identity.ts';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

const DEFAULT_SUBJECT_TYPE = 'page';
const DEFAULT_SEARCH_SUBJECT_TYPE = 'site';

const PixelQuerySchema = z.object({
  s: z.string().min(1).max(512),
  t: z.string().min(1).max(32).optional(),
  v: z.string().min(1).max(64).optional(),
});

const NullableString = (max: number) => z.string().max(max).nullable().optional();
const NullableInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable().optional();

const BeaconBodySchema = z.object({
  key: z.string(),
  subjectType: z.string().min(1).max(32).nullable().optional(),
  subjectId: z.string().min(1).max(512),
  path: NullableString(512),
  referrer: NullableString(512),
  visitorId: NullableString(64),
  locale: NullableString(16),
  dwellMs: z.number().int().min(0).nullable().optional(),
  readDepth: NullableInt(0, 100),
  viewId: NullableString(64),
  utm: z
    .object({
      source: NullableString(128),
      medium: NullableString(128),
      campaign: NullableString(128),
    })
    .nullable()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const SearchBodySchema = z.object({
  key: z.string(),
  query: z.string().min(1).max(256),
  resultCount: z.number().int().min(0),
  subjectType: z.string().min(1).max(32).nullable().optional(),
  locale: NullableString(16),
  visitorId: NullableString(64),
});

interface ResolvedTracker {
  trackerId: string;
  orgId: string;
  apiKeyId: string;
  allowedOrigins: string[];
  identityVerificationSecret: string | null;
  requireVerifiedIdentity: boolean;
  canonicalLocales: string[];
}

const IdentifyBodySchema = z.object({
  key: z.string(),
  visitorId: z.string().min(1).max(64),
  externalId: z.string().min(1).max(256),
  userHash: z.string().min(1).max(256),
  email: z.string().email().max(320).optional(),
});

@PublicController('v1/a', { throttle: true })
export class AnalyticsTrackerController {
  private readonly logger = new Logger(AnalyticsTrackerController.name);

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
    if (!parsed.success) {
      this.logger.warn(`pixel.validation_failed: ${parsed.error.message}`);
      return;
    }
    const { s: subjectId, t: subjectType, v: visitorId } = parsed.data;
    const tracker = await this.resolveTrackerKey(key);
    if (!tracker) return;
    if (!originIsAllowed(tracker.allowedOrigins, origin)) return;

    await this.analytics.recordView({
      orgId: tracker.orgId,
      subjectType: subjectType ?? DEFAULT_SUBJECT_TYPE,
      subjectId: canonicalSubject(tracker, subjectId, null),
      source: 'tracker',
      trackerId: tracker.trackerId,
      referrer: referer ?? null,
      visitorId: visitorId ?? null,
      userAgentClass: 'browser',
      country: this.geoip.lookupCountry(req.ip),
      requireVerifiedIdentity: tracker.requireVerifiedIdentity,
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
    if (!parsed.success) {
      this.logger.warn(`beacon.validation_failed: ${parsed.error.message}`);
      return;
    }
    const body = parsed.data;
    const tracker = await this.resolveTrackerKey(body.key);
    if (!tracker) return;
    if (!originIsAllowed(tracker.allowedOrigins, origin)) return;

    await this.analytics.recordView({
      orgId: tracker.orgId,
      subjectType: body.subjectType ?? DEFAULT_SUBJECT_TYPE,
      subjectId: canonicalSubject(tracker, body.subjectId, body.locale ?? null),
      source: 'tracker',
      trackerId: tracker.trackerId,
      path: body.path ?? null,
      locale: body.locale ?? null,
      referrer: body.referrer ?? referer ?? null,
      visitorId: body.visitorId ?? null,
      dwellMs: body.dwellMs ?? null,
      readDepth: body.readDepth ?? null,
      clientViewId: body.viewId ?? null,
      utmSource: body.utm?.source ?? null,
      utmMedium: body.utm?.medium ?? null,
      utmCampaign: body.utm?.campaign ?? null,
      userAgentClass: 'tracker',
      country: this.geoip.lookupCountry(req.ip),
      metadata: body.metadata ?? null,
      requireVerifiedIdentity: tracker.requireVerifiedIdentity,
    });
  }

  @Post('s')
  @HttpCode(204)
  async trackerSearch(
    @Body() rawBody: unknown,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('origin') origin: string | undefined,
  ): Promise<void> {
    if (looksLikeBot(userAgent)) return;
    const parsed = SearchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      this.logger.warn(`search.validation_failed: ${parsed.error.message}`);
      return;
    }
    const body = parsed.data;
    const tracker = await this.resolveTrackerKey(body.key);
    if (!tracker) return;
    if (!originIsAllowed(tracker.allowedOrigins, origin)) return;

    await this.analytics.recordSearch({
      orgId: tracker.orgId,
      subjectType: body.subjectType ?? DEFAULT_SEARCH_SUBJECT_TYPE,
      query: body.query,
      resultCount: body.resultCount,
      trackerId: tracker.trackerId,
      locale: body.locale ?? null,
      visitorId: body.visitorId ?? null,
      requireVerifiedIdentity: tracker.requireVerifiedIdentity,
    });
  }

  @Post('identify')
  @HttpCode(204)
  async identify(
    @Body() rawBody: unknown,
    @Headers('origin') origin: string | undefined,
  ): Promise<void> {
    const parsed = IdentifyBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      this.logger.warn(`identify.validation_failed: ${parsed.error.message}`);
      return;
    }
    const body = parsed.data;
    const tracker = await this.resolveTrackerKey(body.key);
    if (!tracker) return;
    if (!originIsAllowed(tracker.allowedOrigins, origin)) return;

    const secret = tracker.identityVerificationSecret;
    if (!secret) {
      this.logger.warn(
        `identify.rejected: tracker ${tracker.trackerId} has no identity_verification_secret`,
      );
      return;
    }
    const signature = body.userHash.toLowerCase();
    const canonical = identityHashPayload({
      externalId: body.externalId,
      visitorId: body.visitorId,
      email: body.email ?? null,
    });
    const ok =
      verifyHmac(canonical, secret, signature) ||
      (body.email === undefined &&
        verifyHmac(
          legacyIdentityHashPayload(body.externalId, body.visitorId),
          secret,
          signature,
        ));
    if (!ok) {
      this.logger.warn(`identify.rejected: hmac_mismatch tracker=${tracker.trackerId}`);
      return;
    }

    const email = normalizeIdentityEmail(body.email);

    try {
      await this.db.transaction(async (tx: Tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const resolution = await resolveIdentifiedEndUser(
          tx,
          tracker.orgId,
          body.externalId,
          email,
        );
        if (resolution.outcome === 'email-held-by-another-identity') {
          this.logger.warn(
            `identify.email_conflict: tracker=${tracker.trackerId} end_user=${resolution.endUserId} left unlinked from its email, which belongs to a different identity — needs a manual merge`,
          );
        }
        await linkVisitorToEndUser(tx, tracker.orgId, body.visitorId, resolution.endUserId);
      });
    } catch (err) {
      this.logger.warn(`identify.persist_failed: ${(err as Error).message}`);
    }
  }

  private async resolveTrackerKey(rawKey: string): Promise<ResolvedTracker | null> {
    if (!rawKey || !isWellFormedKey(rawKey) || !rawKey.startsWith('mn_track_')) return null;
    try {
      const hash = hashSecret(rawKey);
      await this.db
        .select({ id: schema.apiKeys.id })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.keyHash, hash))
        .limit(1);
      const keyRows = await this.db
        .select({
          apiKeyId: schema.apiKeys.id,
          orgId: schema.apiKeys.orgId,
          trackerId: schema.apiKeys.trackerId,
        })
        .from(schema.apiKeys)
        .where(
          and(
            eq(schema.apiKeys.keyPrefix, keyPrefix(rawKey)),
            eq(schema.apiKeys.keyHash, hash),
            eq(schema.apiKeys.type, 'track'),
            isNull(schema.apiKeys.revokedAt),
          ),
        )
        .limit(1);
      const keyRow = keyRows[0];
      if (!keyRow || !keyRow.orgId || !keyRow.trackerId) return null;
      const trackerRows = await this.db
        .select({
          id: schema.analyticsTrackers.id,
          allowedOrigins: schema.analyticsTrackers.allowedOrigins,
          identityVerificationSecret: schema.analyticsTrackers.identityVerificationSecret,
          requireVerifiedIdentity: schema.analyticsTrackers.requireVerifiedIdentity,
          canonicalLocales: schema.analyticsTrackers.canonicalLocales,
        })
        .from(schema.analyticsTrackers)
        .where(eq(schema.analyticsTrackers.id, keyRow.trackerId))
        .limit(1);
      const trackerRow = trackerRows[0];
      if (!trackerRow) return null;
      void this.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, keyRow.apiKeyId))
        .then(undefined, () => undefined);
      return {
        trackerId: trackerRow.id,
        orgId: keyRow.orgId,
        apiKeyId: keyRow.apiKeyId,
        allowedOrigins: trackerRow.allowedOrigins,
        identityVerificationSecret: trackerRow.identityVerificationSecret,
        requireVerifiedIdentity: trackerRow.requireVerifiedIdentity,
        canonicalLocales: trackerRow.canonicalLocales,
      };
    } catch {
      return null;
    }
  }
}

function canonicalSubject(
  tracker: ResolvedTracker,
  subjectId: string,
  locale: string | null,
): string {
  return canonicalizeSubjectId(subjectId, {
    locale,
    localeOverrides: tracker.canonicalLocales,
  });
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
  return parseEnvBool({ name: 'MUNIN_TRACKER_REQUIRE_ALLOWLIST', default: false });
}

function sendPixel(res: Response): void {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(TRANSPARENT_GIF.length));
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).end(TRANSPARENT_GIF);
}

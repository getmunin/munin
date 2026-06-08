import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { DB } from '../../common/db/db.module.ts';

export interface RecordViewInput {
  orgId: string;
  subjectType: string;
  subjectId: string;
  source: 'pixel' | 'beacon' | 'tracker';
  path?: string | null;
  locale?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  visitorId?: string | null;
  userAgentClass?: string | null;
  dwellMs?: number | null;
  readDepth?: number | null;
  country?: string | null;
  metadata?: Record<string, unknown> | null;
  requireVerifiedIdentity?: boolean;
}

export interface RecordSearchInput {
  orgId: string;
  subjectType: string;
  query: string;
  resultCount: number;
  locale?: string | null;
  visitorId?: string | null;
  requireVerifiedIdentity?: boolean;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async recordView(input: RecordViewInput): Promise<void> {
    try {
      const visitorId = truncate(input.visitorId, 64);
      const endUserId = await this.resolveEndUserId(input.orgId, visitorId);
      if (input.requireVerifiedIdentity && !endUserId) return;
      await this.db.insert(schema.analyticsViewEvents).values({
        orgId: input.orgId,
        subjectType: input.subjectType.slice(0, 32),
        subjectId: input.subjectId,
        source: input.source,
        path: truncate(input.path, 512),
        locale: truncate(input.locale, 16),
        referrer: truncate(input.referrer, 512),
        utmSource: truncate(input.utmSource, 128),
        utmMedium: truncate(input.utmMedium, 128),
        utmCampaign: truncate(input.utmCampaign, 128),
        visitorId,
        endUserId,
        userAgentClass: truncate(input.userAgentClass, 16),
        dwellMs: clampInt(input.dwellMs, 0, 24 * 60 * 60 * 1000),
        readDepth: clampInt(input.readDepth, 0, 100),
        country: normalizeCountry(input.country),
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      this.logger.warn(`analytics.view.record_failed: ${(err as Error).message}`);
    }
  }

  async recordSearch(input: RecordSearchInput): Promise<void> {
    try {
      const q = input.query.trim();
      if (!q) return;
      const visitorId = truncate(input.visitorId, 64);
      const endUserId = await this.resolveEndUserId(input.orgId, visitorId);
      if (input.requireVerifiedIdentity && !endUserId) return;
      await this.db.insert(schema.analyticsSearchEvents).values({
        orgId: input.orgId,
        subjectType: input.subjectType.slice(0, 32),
        query: q.slice(0, 256),
        locale: truncate(input.locale, 16),
        resultCount: Math.max(0, Math.floor(input.resultCount)),
        visitorId,
        endUserId,
      });
    } catch (err) {
      this.logger.warn(`analytics.search.record_failed: ${(err as Error).message}`);
    }
  }

  private async resolveEndUserId(
    orgId: string,
    visitorId: string | null,
  ): Promise<string | null> {
    if (!visitorId) return null;
    try {
      const rows = await this.db
        .select({ endUserId: schema.analyticsVisitorIdentities.endUserId })
        .from(schema.analyticsVisitorIdentities)
        .where(
          and(
            eq(schema.analyticsVisitorIdentities.orgId, orgId),
            eq(schema.analyticsVisitorIdentities.visitorId, visitorId),
          ),
        )
        .limit(1);
      return rows[0]?.endUserId ?? null;
    } catch {
      return null;
    }
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function clampInt(
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

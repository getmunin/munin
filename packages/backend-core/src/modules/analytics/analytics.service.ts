import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
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
  metadata?: Record<string, unknown> | null;
}

export interface RecordSearchInput {
  orgId: string;
  subjectType: string;
  query: string;
  resultCount: number;
  locale?: string | null;
  visitorId?: string | null;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async recordView(input: RecordViewInput): Promise<void> {
    try {
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
        visitorId: truncate(input.visitorId, 64),
        userAgentClass: truncate(input.userAgentClass, 16),
        dwellMs: clampInt(input.dwellMs, 0, 24 * 60 * 60 * 1000),
        readDepth: clampInt(input.readDepth, 0, 100),
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
      await this.db.insert(schema.analyticsSearchEvents).values({
        orgId: input.orgId,
        subjectType: input.subjectType.slice(0, 32),
        query: q.slice(0, 256),
        locale: truncate(input.locale, 16),
        resultCount: Math.max(0, Math.floor(input.resultCount)),
        visitorId: truncate(input.visitorId, 64),
      });
    } catch (err) {
      this.logger.warn(`analytics.search.record_failed: ${(err as Error).message}`);
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

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { buildCompanionPrompt, COMPANION_JOB_URI, draftsOnPublish } from './companion-job.ts';
import type { SocialPlatform } from './social-platform.ts';

const ENTRY_PUBLISHED = 'cms.entry.published';

const COMPANION_PLATFORM: SocialPlatform = 'linkedin';

export interface JobEnqueuer {
  enqueue(input: {
    jobUri: string;
    userPrompt: string;
    sourceEventType?: string;
    sourceEventPayload?: unknown;
    dedupeKey?: string;
  }): Promise<unknown>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

@Injectable()
export class SocialCompanionSink implements EventSink {
  constructor(@Inject(CuratorJobsService) private readonly curatorJobs: JobEnqueuer) {}

  async onEvent(event: EmittedEvent): Promise<void> {
    if (event.type !== ENTRY_PUBLISHED) return;
    if (event.payload.previousStatus === 'published') return;

    const entryId = str(event.payload.entryId);
    const collectionSlug = str(event.payload.collectionSlug);
    const url = str(event.payload.url);
    const title = str(event.payload.title);
    if (!entryId || !collectionSlug || !url || !title) return;

    const ctx = getCurrentContext();
    const orgId = event.orgId;

    const [collection] = await ctx.db
      .select({ settings: schema.cmsCollections.settings })
      .from(schema.cmsCollections)
      .where(
        and(
          eq(schema.cmsCollections.orgId, orgId),
          eq(schema.cmsCollections.slug, collectionSlug),
        ),
      )
      .limit(1);
    if (!collection || !draftsOnPublish(collection.settings)) return;

    const [existing] = await ctx.db
      .select({ id: schema.socialPostDrafts.id })
      .from(schema.socialPostDrafts)
      .where(
        and(
          eq(schema.socialPostDrafts.orgId, orgId),
          sql`${schema.socialPostDrafts.sourceRef}->>'type' = 'cms_entry'`,
          sql`${schema.socialPostDrafts.sourceRef}->>'id' = ${entryId}`,
        ),
      )
      .limit(1);
    if (existing) return;

    await this.curatorJobs.enqueue({
      jobUri: COMPANION_JOB_URI,
      userPrompt: buildCompanionPrompt({
        entryId,
        collectionSlug,
        locale: str(event.payload.locale) ?? 'default',
        title,
        url,
        platform: COMPANION_PLATFORM,
      }),
      sourceEventType: event.type,
      sourceEventPayload: event.payload,
      dedupeKey: `social-companion:entry:${entryId}`,
    });
  }
}

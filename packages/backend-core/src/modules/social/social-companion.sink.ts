import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import {
  buildCompanionPrompt,
  companionDedupeKey,
  COMPANION_JOB_URI,
  DEFAULT_COMPANION_PLATFORM,
  draftsOnPublish,
} from './companion-job.ts';
import { describePlatform, isSocialPlatform, type SocialPlatform } from './social-platform.ts';

const ENTRY_PUBLISHED = 'cms.entry.published';

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

    const drafted = await ctx.db
      .select({ platform: schema.socialPostDrafts.platform })
      .from(schema.socialPostDrafts)
      .where(
        and(
          eq(schema.socialPostDrafts.orgId, orgId),
          sql`${schema.socialPostDrafts.sourceRef}->>'type' = 'cms_entry'`,
          sql`${schema.socialPostDrafts.sourceRef}->>'id' = ${entryId}`,
        ),
      );
    const alreadyDrafted = new Set(drafted.map((row) => row.platform));

    for (const platform of await this.platformsFor(orgId)) {
      if (alreadyDrafted.has(platform)) continue;
      await this.curatorJobs.enqueue({
        jobUri: COMPANION_JOB_URI,
        userPrompt: buildCompanionPrompt({
          entryId,
          collectionSlug,
          locale: str(event.payload.locale) ?? 'default',
          title,
          url,
          platform,
        }),
        sourceEventType: event.type,
        sourceEventPayload: event.payload,
        dedupeKey: companionDedupeKey(entryId, platform),
      });
    }
  }

  private async platformsFor(orgId: string): Promise<SocialPlatform[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .selectDistinct({ platform: schema.socialAccounts.platform })
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.orgId, orgId));

    const connected = rows
      .map((row) => row.platform)
      .filter(isSocialPlatform)
      .filter((platform) => describePlatform(platform).canPublish)
      .sort();

    return connected.length > 0 ? connected : [DEFAULT_COMPANION_PLATFORM];
  }
}

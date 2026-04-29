import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@munin/db';
import { and, eq, lte, sql } from 'drizzle-orm';
import { WebhookDispatcher, ActorIdentity, withContext, type RequestContext } from '@munin/core';
import { randomUUID } from 'node:crypto';
import { DB } from '../../common/db/db.module.js';

const POLL_INTERVAL_MS = Number(process.env.MUNIN_CMS_SCHEDULE_POLL_MS ?? 60_000);
const BATCH_SIZE = 50;

/**
 * In-process worker that flips `status='scheduled'` entries to
 * `published` when their `scheduled_at` is reached, stamps
 * `published_at`, and fires `cms.entry.published`.
 *
 * Service-role DB so we can read across orgs without a tenant context.
 * For each due entry we open a transaction with `app.bypass_rls=on` and
 * an actor synthesized from the entry's row (so the audit chain has
 * something to attribute), then perform the flip.
 *
 * Disabled in tests via MUNIN_CMS_SCHEDULE_WORKER_DISABLED=1 or
 * NODE_ENV=test; tests call worker.tick() directly.
 */
@Injectable()
export class CmsScheduleWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drain a batch of due entries. Public so tests can call directly. */
  async tick(): Promise<{ promoted: number }> {
    if (this.running) return { promoted: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ promoted: number }> {
    const now = new Date();
    const due = await this.db
      .select()
      .from(schema.cmsEntries)
      .where(
        and(
          eq(schema.cmsEntries.status, 'scheduled'),
          lte(schema.cmsEntries.scheduledAt, now),
        ),
      )
      .limit(BATCH_SIZE);

    if (due.length === 0) return { promoted: 0 };

    let promoted = 0;
    for (const entry of due) {
      try {
        await this.promoteOne(entry);
        promoted += 1;
      } catch (err) {
        console.error('[cms.schedule] failed to promote entry', entry.id, err);
      }
    }
    return { promoted };
  }

  private async promoteOne(entry: typeof schema.cmsEntries.$inferSelect): Promise<void> {
    // Look up the collection's slug for the webhook payload.
    const [collection] = await this.db
      .select({ slug: schema.cmsCollections.slug })
      .from(schema.cmsCollections)
      .where(eq(schema.cmsCollections.id, entry.collectionId))
      .limit(1);

    // Synthesize a system actor for the audit chain. The flip runs in a
    // service-role transaction (bypass=on session-level), so RLS doesn't
    // gate it; the actor just attributes the audit row.
    const actor = new ActorIdentity('system', 'cms-schedule-worker', entry.orgId, ['*'], ['admin']);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = {
        db: tx,
        actor,
        correlationId: randomUUID(),
      };
      await withContext(ctx, async () => {
        await tx
          .update(schema.cmsEntries)
          .set({
            status: 'published',
            publishedAt: new Date(),
            scheduledAt: null,
            version: entry.version + 1,
            updatedAt: new Date(),
            updatedByType: 'agent',
            updatedById: actor.id,
          })
          .where(eq(schema.cmsEntries.id, entry.id));
        await tx.insert(schema.cmsEntryVersions).values({
          orgId: entry.orgId,
          entryId: entry.id,
          version: entry.version + 1,
          status: 'published',
          data: entry.data,
          createdByType: 'agent',
          createdById: actor.id,
        });
        await this.webhooks.emit({
          type: 'cms.entry.published',
          payload: {
            entryId: entry.id,
            collectionSlug: collection?.slug ?? '',
            slug: entry.slug,
            locale: entry.locale,
            status: 'published',
            version: entry.version + 1,
          },
        });
      });
    });
  }
}

export { POLL_INTERVAL_MS };

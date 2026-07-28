import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, lt, lte, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  parseEnvDisableFlag,
  parseEnvInt,
  withContext,
  type AssetStorage,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { DB } from '../../common/db/db.module.ts';
import { STORAGE } from '../../common/storage/storage.token.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import {
  NO_VARIANTS,
  UndecodableImageError,
  VARIANT_LADDER_VERSION,
  deriveVariantColumns,
  isVariantableMime,
  type VariantColumns,
} from './cms.variants.ts';

const POLL_INTERVAL_MS = parseEnvInt({ name: 'MUNIN_CMS_SCHEDULE_POLL_MS', default: 60_000 });
const BATCH_SIZE = 50;
const VARIANT_BATCH_SIZE = parseEnvInt({ name: 'MUNIN_CMS_VARIANT_BATCH', default: 10 });

@Injectable()
export class CmsScheduleWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    parseEnvDisableFlag('MUNIN_CMS_SCHEDULE_WORKER_DISABLED') ||
    process.env.NODE_ENV === 'test';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(STORAGE) private readonly storage: AssetStorage,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'cms-schedule-worker', () => this.tick());
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ promoted: number; reconciled: number }> {
    if (this.running) return { promoted: 0, reconciled: 0 };
    this.running = true;
    try {
      const { promoted } = await this.drain();
      const { reconciled } = await this.reconcileVariants();
      return { promoted, reconciled };
    } finally {
      this.running = false;
    }
  }

  async reconcileVariants(): Promise<{ reconciled: number }> {
    const stale = await this.db
      .select({
        id: schema.cmsAssets.id,
        orgId: schema.cmsAssets.orgId,
        mime: schema.cmsAssets.mime,
        storageKey: schema.cmsAssets.storageKey,
      })
      .from(schema.cmsAssets)
      .where(
        and(
          eq(schema.cmsAssets.uploaded, true),
          lt(schema.cmsAssets.variantsVersion, VARIANT_LADDER_VERSION),
        ),
      )
      .limit(VARIANT_BATCH_SIZE);

    let reconciled = 0;
    for (const asset of stale) {
      try {
        await this.reconcileOne(asset);
        reconciled += 1;
      } catch (err) {
        if (err instanceof UndecodableImageError) {
          await this.settleWithoutVariants(asset);
          continue;
        }
        console.error('[cms.variants] deferred asset', asset.id, err);
      }
    }
    return { reconciled };
  }

  private async reconcileOne(asset: {
    id: string;
    orgId: string;
    mime: string;
    storageKey: string;
  }): Promise<void> {
    if (!isVariantableMime(asset.mime)) {
      await this.settleWithoutVariants(asset);
      return;
    }
    const body = await this.storage.readBytes(asset.storageKey);
    if (body === null) {
      await this.settleWithoutVariants(asset);
      return;
    }
    const derived = await deriveVariantColumns(this.storage, {
      mime: asset.mime,
      storageKey: asset.storageKey,
      body,
    });
    await this.writeVariantColumns(asset, derived);
  }

  private settleWithoutVariants(asset: { id: string; orgId: string }): Promise<void> {
    return this.writeVariantColumns(asset, NO_VARIANTS);
  }

  private async writeVariantColumns(
    asset: { id: string; orgId: string },
    columns: VariantColumns,
  ): Promise<void> {
    const actor = new ActorIdentity('system', 'cms-variant-worker', asset.orgId, ['*'], ['admin']);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        await tx
          .update(schema.cmsAssets)
          .set({ ...columns, updatedAt: new Date() })
          .where(eq(schema.cmsAssets.id, asset.id));
      });
    });
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
    const [collection] = await this.db
      .select({ slug: schema.cmsCollections.slug })
      .from(schema.cmsCollections)
      .where(eq(schema.cmsCollections.id, entry.collectionId))
      .limit(1);

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

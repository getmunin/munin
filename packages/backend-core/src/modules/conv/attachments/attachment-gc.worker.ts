import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import {
  describeError,
  parseEnvDisableFlag,
  parseEnvInt,
  type AssetStorage,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { STORAGE } from '../../../common/storage/storage.token.ts';
import { withSchedulerLock } from '../../../common/scheduler-lock/index.ts';

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const DEFAULT_GRACE_MINUTES = 60;
const MAX_PER_TICK = 200;

interface AbandonedRow extends Record<string, unknown> {
  id: string;
  storage_key: string | null;
  variants: unknown;
}

@Injectable()
export class AttachmentGcWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentGcWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_ATTACHMENT_GC_WORKER_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_ATTACHMENT_GC_WORKER_INTERVAL_MS',
    default: DEFAULT_INTERVAL_MS,
  });
  private readonly graceMinutes = parseEnvInt({
    name: 'MUNIN_ATTACHMENT_GC_GRACE_MINUTES',
    default: DEFAULT_GRACE_MINUTES,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: AssetStorage,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(
      `attachment gc worker starting (every ${this.intervalMs}ms, grace ${this.graceMinutes}m)`,
    );
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'attachment-gc-worker', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ collected: number }> {
    if (this.running) return { collected: 0 };
    this.running = true;
    try {
      const rows = await this.claimAbandoned();
      let collected = 0;
      for (const row of rows) {
        for (const key of storageKeysOf(row)) {
          await this.storage.delete(key).catch((err: unknown) => {
            this.logger.warn(`could not purge abandoned object ${key}: ${describeError(err)}`);
          });
        }
        collected += 1;
      }
      if (collected > 0) {
        this.logger.log(`collected ${collected} abandoned attachment upload(s)`);
      }
      return { collected };
    } finally {
      this.running = false;
    }
  }

  private async claimAbandoned(): Promise<AbandonedRow[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx.execute<AbandonedRow>(sql`
        DELETE FROM conv_attachments
        WHERE id IN (
          SELECT id FROM conv_attachments
          WHERE message_id IS NULL
            AND deleted_at IS NULL
            AND created_at < now() - make_interval(mins => ${this.graceMinutes})
          ORDER BY created_at
          LIMIT ${MAX_PER_TICK}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, storage_key, variants
      `);
      return toArray(rows);
    });
  }
}

function storageKeysOf(row: AbandonedRow): string[] {
  const keys: string[] = [];
  if (row.storage_key) keys.push(row.storage_key);
  if (Array.isArray(row.variants)) {
    for (const v of row.variants) {
      if (v && typeof v === 'object') {
        const key = (v as { storageKey?: unknown }).storageKey;
        if (typeof key === 'string' && key.length > 0) keys.push(key);
      }
    }
  }
  return keys;
}

function toArray<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

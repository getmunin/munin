import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { DB } from '../../common/db/db.module.ts';

const INSTANCE_ID_KEY = 'instance_id';

@Injectable()
export class InstanceIdService {
  private readonly logger = new Logger(InstanceIdService.name);
  private cached: string | null = null;
  private inflight: Promise<string> | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  async get(): Promise<string> {
    if (this.cached) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.findOrCreate().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async findOrCreate(): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const existing = await tx
        .select({ value: schema.systemConfig.value })
        .from(schema.systemConfig)
        .where(eq(schema.systemConfig.key, INSTANCE_ID_KEY))
        .limit(1);
      const stored = existing[0]?.value;
      if (typeof stored === 'string' && /^[0-9a-f-]{36}$/i.test(stored)) {
        this.cached = stored;
        return stored;
      }
      const fresh = randomUUID();
      await tx
        .insert(schema.systemConfig)
        .values({ key: INSTANCE_ID_KEY, value: fresh })
        .onConflictDoNothing({ target: schema.systemConfig.key });
      const after = await tx
        .select({ value: schema.systemConfig.value })
        .from(schema.systemConfig)
        .where(eq(schema.systemConfig.key, INSTANCE_ID_KEY))
        .limit(1);
      const final = after[0]?.value;
      if (typeof final !== 'string') {
        this.logger.error('failed to persist instance_id');
        throw new Error('instance_id_persist_failed');
      }
      this.cached = final;
      return final;
    });
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { parseEnvDisableFlag, parseEnvInt } from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { withSchedulerLock } from '../../../common/scheduler-lock/index.ts';
import { SendingIdentityService } from './sending-identity.service.ts';

const INTERVAL_MS = parseEnvInt({
  name: 'MUNIN_SENDING_IDENTITY_REFRESH_MS',
  default: 300_000,
});

const MAX_PER_TICK = 50;

@Injectable()
export class SendingIdentityRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SendingIdentityRefreshWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    parseEnvDisableFlag('MUNIN_SENDING_IDENTITY_REFRESH_DISABLED') ||
    process.env.NODE_ENV === 'test';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SendingIdentityService) private readonly identities: SendingIdentityService,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`sending identity refresh starting (every ${INTERVAL_MS}ms)`);
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'sending-identity-refresh', () => this.tick());
    }, INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ checked: number; verified: number }> {
    if (this.running) return { checked: 0, verified: 0 };
    this.running = true;
    try {
      return await this.runOnce();
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<{ checked: number; verified: number }> {
    const pending = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return tx
        .select()
        .from(schema.convSendingIdentities)
        .where(eq(schema.convSendingIdentities.status, 'pending'))
        .limit(MAX_PER_TICK);
    });

    let verified = 0;
    for (const row of pending) {
      try {
        const result = await this.identities.checkOne(row);
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
          await tx
            .update(schema.convSendingIdentities)
            .set(this.identities.statusPatch(row, result))
            .where(eq(schema.convSendingIdentities.id, row.id));
        });
        if (result.status === 'verified') {
          verified += 1;
          this.logger.log(`sending identity verified domain=${row.domain} org=${row.orgId}`);
        }
      } catch (err) {
        this.logger.warn(
          `sending identity refresh failed domain=${row.domain}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { checked: pending.length, verified };
  }
}

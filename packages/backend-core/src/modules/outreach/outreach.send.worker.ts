import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  parseEnvDisableFlag,
  parseEnvInt,
  readApiBaseUrl,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import {
  MAX_SEND_ATTEMPTS,
  OutreachInvalidError,
  OutreachService,
  SEND_WORKER_ACTOR_ID,
  type ScheduledSendOutcome,
} from './outreach.service.ts';

const DEFAULT_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

interface DueProposal {
  id: string;
  orgId: string;
}

export interface OutreachSendTickResult {
  sent: number;
  deferred: number;
  failed: number;
}

@Injectable()
export class OutreachSendWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachSendWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_OUTREACH_SEND_WORKER_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_OUTREACH_SEND_POLL_MS',
    default: DEFAULT_INTERVAL_MS,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outreach: OutreachService,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`outreach send worker starting (every ${this.intervalMs}ms)`);
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'outreach-send-worker', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<OutreachSendTickResult> {
    if (this.running) return { sent: 0, deferred: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<OutreachSendTickResult> {
    const due = await this.dueProposals();
    const result: OutreachSendTickResult = { sent: 0, deferred: 0, failed: 0 };
    for (const proposal of due) {
      let outcome: ScheduledSendOutcome;
      try {
        outcome = await this.sendOne(proposal);
      } catch (err) {
        result.failed += 1;
        await this.recordFailure(proposal, err);
        continue;
      }
      if (outcome === 'sent') result.sent += 1;
      if (outcome === 'deferred') result.deferred += 1;
    }
    return result;
  }

  private async dueProposals(): Promise<DueProposal[]> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return await tx
        .select({
          id: schema.outreachProposals.id,
          orgId: schema.outreachProposals.orgId,
        })
        .from(schema.outreachProposals)
        .where(
          and(
            eq(schema.outreachProposals.status, 'approved'),
            lte(schema.outreachProposals.scheduledSendAt, new Date()),
            lt(schema.outreachProposals.sendAttempts, MAX_SEND_ATTEMPTS),
          ),
        )
        .orderBy(asc(schema.outreachProposals.scheduledSendAt))
        .limit(BATCH_SIZE);
    });
  }

  private async sendOne(proposal: DueProposal): Promise<ScheduledSendOutcome> {
    const result = await this.inOrgContext(proposal.orgId, () =>
      this.outreach.sendScheduledProposal(proposal.id, { publicBaseUrl: readApiBaseUrl() }),
    );
    if (result.outcome === 'deferred') {
      this.logger.log(`deferred ${proposal.id}: ${result.reason}`);
    }
    return result.outcome;
  }

  private async recordFailure(proposal: DueProposal, err: unknown): Promise<void> {
    const terminal = err instanceof OutreachInvalidError;
    const reason = describe(err);
    this.logger.warn(
      `${terminal ? 'refusing' : 'retrying'} scheduled send ${proposal.id}: ${reason}`,
    );
    try {
      await this.inOrgContext(proposal.orgId, () =>
        this.outreach.recordScheduledSendFailure(proposal.id, reason, { terminal }),
      );
    } catch (writeErr) {
      this.logger.error(
        `could not record send failure for ${proposal.id}: ${describe(writeErr)}`,
      );
    }
  }

  private inOrgContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('system', SEND_WORKER_ACTOR_ID, orgId, ['*'], ['admin']);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return await withContext(ctx, fn);
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

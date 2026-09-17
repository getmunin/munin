import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { parseEnvDisableFlag, parseEnvInt } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import { EXPIRY_WARNING_MS, SocialAccountsService } from './social-accounts.service.ts';
import type { SocialPlatform } from './social-platform.ts';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 200;

export interface SocialExpiryTickResult {
  warned: number;
  expired: number;
}

interface DueAccount {
  id: string;
  orgId: string;
  userId: string;
  platform: string;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  encryptedRefreshToken: string | null;
}

export interface GrantDeadline {
  at: Date | null;
  renewable: boolean;
}

export function grantDeadline(row: {
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  encryptedRefreshToken: string | null;
}): GrantDeadline {
  return row.encryptedRefreshToken
    ? { at: row.refreshTokenExpiresAt, renewable: true }
    : { at: row.accessTokenExpiresAt, renewable: false };
}

export function expiryReason(deadline: GrantDeadline, now: number): string {
  const subject = deadline.renewable ? 'the renewal grant' : 'the access grant';
  if (!deadline.at) return `${subject} has no recorded expiry`;
  const days = Math.round((deadline.at.getTime() - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return `${subject} has expired and the person must authorize again`;
  return `${subject} expires in ${days} day${days === 1 ? '' : 's'}`;
}

@Injectable()
export class SocialExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialExpiryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    parseEnvDisableFlag('MUNIN_SOCIAL_EXPIRY_WORKER_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly intervalMs = parseEnvInt({
    name: 'MUNIN_SOCIAL_EXPIRY_POLL_MS',
    default: DEFAULT_INTERVAL_MS,
  });

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SocialAccountsService) private readonly accounts: SocialAccountsService,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.logger.log(`social expiry worker starting (every ${this.intervalMs}ms)`);
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'social-expiry-worker', () => this.tick());
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: number = Date.now()): Promise<SocialExpiryTickResult> {
    if (this.running) return { warned: 0, expired: 0 };
    this.running = true;
    try {
      return await this.sweep(now);
    } finally {
      this.running = false;
    }
  }

  private async sweep(now: number): Promise<SocialExpiryTickResult> {
    const due = await this.dueAccounts(now);
    let warned = 0;
    let expired = 0;
    for (const row of due) {
      const platform = row.platform as SocialPlatform;
      const deadline = grantDeadline(row);
      const past = (deadline.at?.getTime() ?? 0) <= now;
      try {
        if (past) {
          await this.db
            .update(schema.socialAccounts)
            .set({
              status: 'expired',
              lastError: expiryReason(deadline, now),
              updatedAt: new Date(),
            })
            .where(eq(schema.socialAccounts.id, row.id));
          expired += 1;
        } else {
          warned += 1;
        }
        await this.accounts.raiseReconnectAlert({
          orgId: row.orgId,
          userId: row.userId,
          platform,
          reason: expiryReason(deadline, now),
          severity: past ? 'error' : 'warning',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`social account ${row.id} expiry sweep failed: ${message}`);
      }
    }
    return { warned, expired };
  }

  private async dueAccounts(now: number): Promise<DueAccount[]> {
    return await this.db
      .select({
        id: schema.socialAccounts.id,
        orgId: schema.socialAccounts.orgId,
        userId: schema.socialAccounts.userId,
        platform: schema.socialAccounts.platform,
        accessTokenExpiresAt: schema.socialAccounts.accessTokenExpiresAt,
        refreshTokenExpiresAt: schema.socialAccounts.refreshTokenExpiresAt,
        encryptedRefreshToken: schema.socialAccounts.encryptedRefreshToken,
      })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.status, 'active'),
          or(
            and(
              isNull(schema.socialAccounts.encryptedRefreshToken),
              isNotNull(schema.socialAccounts.accessTokenExpiresAt),
              lte(schema.socialAccounts.accessTokenExpiresAt, new Date(now + EXPIRY_WARNING_MS)),
            ),
            and(
              isNotNull(schema.socialAccounts.encryptedRefreshToken),
              isNotNull(schema.socialAccounts.refreshTokenExpiresAt),
              lte(schema.socialAccounts.refreshTokenExpiresAt, new Date(now + EXPIRY_WARNING_MS)),
            ),
          ),
        ),
      )
      .orderBy(asc(schema.socialAccounts.accessTokenExpiresAt))
      .limit(BATCH_SIZE);
  }
}

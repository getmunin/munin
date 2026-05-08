import { Logger } from '@nestjs/common';
import postgres from 'postgres';

const LOCK_NAMESPACE = 'agent_host';

export class ReplicaLockManager {
  private readonly logger = new Logger(ReplicaLockManager.name);
  private readonly sql: postgres.Sql;
  private reserved: postgres.ReservedSql | null = null;
  private readonly held = new Set<string>();
  private stopped = false;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 1, prepare: false });
  }

  holds(id: string): boolean {
    return this.held.has(id);
  }

  async tryAcquire(id: string): Promise<boolean> {
    if (this.stopped) return false;
    if (this.held.has(id)) return true;
    const reserved = await this.ensureReserved();
    if (!reserved) return false;
    try {
      const result = await reserved<Array<{ got: boolean }>>`
        SELECT pg_try_advisory_lock(hashtextextended(${`${LOCK_NAMESPACE}:${id}`}, 0)) AS got
      `;
      const got = result[0]?.got === true;
      if (got) this.held.add(id);
      return got;
    } catch (err) {
      this.logger.warn(`tryAcquire(${id}) failed; resetting reservation: ${describe(err)}`);
      this.resetReservation();
      return false;
    }
  }

  async release(id: string): Promise<void> {
    if (!this.held.has(id) || !this.reserved) {
      this.held.delete(id);
      return;
    }
    try {
      await this.reserved`
        SELECT pg_advisory_unlock(hashtextextended(${`${LOCK_NAMESPACE}:${id}`}, 0))
      `;
    } catch (err) {
      this.logger.warn(`release(${id}) failed: ${describe(err)}`);
    }
    this.held.delete(id);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reserved) {
      try {
        await this.reserved`SELECT pg_advisory_unlock_all()`;
      } catch (err) {
        this.logger.warn(`unlock_all on stop failed (connection may already be dead): ${describe(err)}`);
      }
      this.reserved.release();
      this.reserved = null;
    }
    this.held.clear();
    await this.sql.end({ timeout: 5 }).catch((err: unknown) => {
      this.logger.warn(`sql.end() on stop failed: ${describe(err)}`);
    });
  }

  private async ensureReserved(): Promise<postgres.ReservedSql | null> {
    if (this.reserved) return this.reserved;
    try {
      this.reserved = await this.sql.reserve();
      return this.reserved;
    } catch (err) {
      this.logger.warn(`reserve() failed: ${describe(err)}`);
      return null;
    }
  }

  private resetReservation(): void {
    if (this.reserved) {
      this.reserved.release();
      this.reserved = null;
    }
    this.held.clear();
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

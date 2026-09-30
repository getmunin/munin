import { sql, type SQL } from 'drizzle-orm';
import { resolvePoolMax } from '@getmunin/db';

const DEFAULT_POOL_MAX = 10;

export interface SchedulerLockDb {
  transaction<T>(fn: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>): Promise<T>;
}

let held = 0;

export function schedulerLockSlots(
  poolMax: number = resolvePoolMax(undefined) ?? DEFAULT_POOL_MAX,
): number {
  return Math.max(1, Math.floor(poolMax / 3));
}

export async function withSchedulerLock<T>(
  db: SchedulerLockDb,
  name: string,
  fn: () => Promise<T>,
  slots: number = schedulerLockSlots(),
): Promise<T | null> {
  if (held >= slots) return null;
  held += 1;
  try {
    return await db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS ok`,
      );
      const row = Array.isArray(result)
        ? (result[0] as { ok?: boolean } | undefined)
        : (result as { rows?: { ok: boolean }[] }).rows?.[0];
      if (!row?.ok) return null;
      return await fn();
    });
  } finally {
    held -= 1;
  }
}

import { sql } from 'drizzle-orm';
import { type Db } from '@getmunin/db';

/**
 * Run `fn` only on the replica that wins a per-name Postgres advisory
 * lock. The other replicas' ticks return `null` immediately.
 *
 * Used for in-process schedulers (cron-driven sweep enqueuers, webhook
 * dispatch loops, CMS scheduled publishing, etc.) that would otherwise
 * fire N times on a backend scaled to N replicas.
 *
 * The lock is *transaction-scoped* (`pg_try_advisory_xact_lock`), so it
 * auto-releases when the wrapping transaction commits or rolls back —
 * no connection-pool reuse gotchas, no leaked locks on crash. The
 * lock is held for the full duration of `fn`, which means `fn` blocks
 * a DB connection until it finishes. Keep ticks short (< 60s); for
 * longer work, enqueue into a durable job table (e.g. curator_jobs)
 * and let row-level claim handle the long-running execution.
 *
 * The name is hashed via Postgres `hashtext()` to a 32-bit int — pick
 * names that won't collide accidentally with other advisory locks in
 * the system (the curator job claim uses `FOR UPDATE SKIP LOCKED`, not
 * advisory, so there's no overlap there).
 */
export async function withSchedulerLock<T>(
  db: Db,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  return await db.transaction(async (tx) => {
    const result = await tx.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS ok`,
    );
    const row = Array.isArray(result) ? result[0] : (result as { rows?: { ok: boolean }[] }).rows?.[0];
    if (!row?.ok) return null;
    return await fn();
  });
}

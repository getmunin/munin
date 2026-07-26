import { sql } from 'drizzle-orm';
import { type Db } from '@getmunin/db';

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

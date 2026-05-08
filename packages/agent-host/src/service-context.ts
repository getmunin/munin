import { randomUUID } from 'node:crypto';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';

export function runWithServiceContext<T>(
  db: Db,
  configId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const actor = new ActorIdentity('system', 'agent-host', configId, ['*'], ['admin']);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const cryptKey = process.env.MUNIN_ENCRYPTION_KEY;
    if (cryptKey) {
      await tx.execute(sql`SELECT set_config('app.crypt_key', ${cryptKey}, true)`);
    }
    const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
    return withContext(ctx, fn);
  });
}

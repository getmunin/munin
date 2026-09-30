import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@getmunin/db';
import { schedulerLockSlots, withSchedulerLock } from './scheduler-lock.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run scheduler lock tests.';

const POOL_MAX = 3;

(skipReason ? describe.skip : describe)('withSchedulerLock against a small pool', () => {
  let db: ReturnType<typeof createDb>;

  beforeAll(() => {
    db = createDb(TEST_URL!, { poolMax: POOL_MAX });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('survives more simultaneous ticks than the pool has connections when each tick queries the database', async () => {
    const ticks = Array.from({ length: POOL_MAX * 2 }, (_, i) =>
      withSchedulerLock(
        db,
        `scheduler-lock-pool-test:${i}`,
        async () => {
          await db.execute(sql`SELECT pg_sleep(0.05)`);
          return i;
        },
        schedulerLockSlots(POOL_MAX),
      ),
    );
    const results = await Promise.all(ticks);
    expect(results.filter((r) => r !== null).length).toBeGreaterThan(0);
    await expect(db.execute(sql`SELECT 1 AS ok`)).resolves.toBeTruthy();
  }, 10_000);
});

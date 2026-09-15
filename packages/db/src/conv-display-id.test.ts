import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run display-id allocation tests.';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

(skipReason ? describe.skip : describe)('conv_next_display_id', () => {
  if (skipReason) it.skip(skipReason, () => {});

  let client: postgres.Sql;
  let probe: postgres.Sql;
  let orgId: string;
  let channelId: string;
  let endUserA: string;
  let endUserB: string;

  beforeAll(async () => {
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    client = postgres(appUrl, { max: 3 });
    probe = postgres(appUrl, { max: 1 });

    const ts = Date.now();
    orgId = `org_display_${ts}`;
    channelId = `cch_display_${ts}`;
    endUserA = `eu_display_a_${ts}`;
    endUserB = `eu_display_b_${ts}`;

    await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
      await sql`INSERT INTO orgs (id, name) VALUES (${orgId}, 'Display id org')`;
      await sql`
        INSERT INTO conv_channels (id, org_id, type, vendor, name)
        VALUES (${channelId}, ${orgId}, 'email', 'smtp', 'Inbound')`;
      await sql`
        INSERT INTO end_users (id, org_id, external_id)
        VALUES (${endUserA}, ${orgId}, 'a'), (${endUserB}, ${orgId}, 'b')`;
      await sql`
        INSERT INTO conv_conversations (id, org_id, display_id, channel_id, end_user_id, status)
        VALUES (${`ccv_display_a_${ts}`}, ${orgId}, 1, ${channelId}, ${endUserA}, 'open'),
               (${`ccv_display_b_${ts}`}, ${orgId}, 2, ${channelId}, ${endUserB}, 'open')`;
    });
  });

  afterAll(async () => {
    if (client) {
      await client.begin(async (sql) => {
        await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
        await sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`;
        await sql`DELETE FROM end_users WHERE org_id = ${orgId}`;
        await sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`;
        await sql`DELETE FROM orgs WHERE id = ${orgId}`;
      });
      await client.end();
    }
    if (probe) await probe.end();
  });

  it('hands a concurrent allocation the next number instead of the one already taken by an uncommitted insert', async () => {
    const inserted = deferred();
    const release = deferred();
    let firstDisplayId = 0;

    const first = client.begin(async (sql) => {
      await sql`SELECT set_config('app.org_id', ${orgId}, true)`;
      const [row] = await sql<{ next: number }[]>`SELECT conv_next_display_id(${orgId}) AS next`;
      firstDisplayId = row!.next;
      await sql`
        INSERT INTO conv_conversations (id, org_id, display_id, channel_id, status)
        VALUES (${`ccv_first_${Date.now()}`}, ${orgId}, ${firstDisplayId}, ${channelId}, 'open')`;
      inserted.resolve();
      await release.promise;
    });

    await inserted.promise;

    let secondDisplayId = 0;
    const second = client.begin(async (sql) => {
      await sql`SELECT set_config('app.org_id', ${orgId}, true)`;
      const [row] = await sql<{ next: number }[]>`SELECT conv_next_display_id(${orgId}) AS next`;
      secondDisplayId = row!.next;
      await sql`
        INSERT INTO conv_conversations (id, org_id, display_id, channel_id, status)
        VALUES (${`ccv_second_${Date.now()}`}, ${orgId}, ${secondDisplayId}, ${channelId}, 'open')`;
    });

    const deadline = Date.now() + 10_000;
    for (;;) {
      const [waiting] = await probe<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (waiting!.count > 0 || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    release.resolve();
    await first;
    await second;

    expect(secondDisplayId).toBe(firstDisplayId + 1);
  });

  it('counts the whole org when the caller is scoped to a single end user', async () => {
    const all = await probe.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
      const [row] = await sql<{ count: number; max: number }[]>`
        SELECT count(*)::int AS count, COALESCE(max(display_id), 0)::int AS max
        FROM conv_conversations WHERE org_id = ${orgId}`;
      return row!;
    });

    await client.begin(async (sql) => {
      await sql`SELECT set_config('app.org_id', ${orgId}, true)`;
      await sql`SELECT set_config('app.end_user_id', ${endUserB}, true)`;
      const [visible] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM conv_conversations WHERE org_id = ${orgId}`;
      const [row] = await sql<{ next: number }[]>`SELECT conv_next_display_id(${orgId}) AS next`;
      expect(visible!.count).toBe(1);
      expect(all.count).toBeGreaterThan(1);
      expect(row!.next).toBe(all.max + 1);
    });
  });

  it('leaves the caller under its own row-level security after allocating', async () => {
    await client.begin(async (sql) => {
      await sql`SELECT set_config('app.org_id', ${orgId}, true)`;
      await sql`SELECT set_config('app.end_user_id', ${endUserB}, true)`;
      await sql`SELECT conv_next_display_id(${orgId}) AS next`;
      const [bypass] = await sql<{ value: string | null }[]>`
        SELECT current_setting('app.bypass_rls', true) AS value`;
      const [visible] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM conv_conversations WHERE org_id = ${orgId}`;
      expect(bypass!.value ?? 'off').not.toBe('on');
      expect(visible!.count).toBe(1);
    });
  });
});

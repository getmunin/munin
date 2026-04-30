import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run RLS tests.';

(skipReason ? describe.skip : describe)('RLS isolation', () => {
  if (skipReason) it.skip(skipReason, () => {});

  let client: postgres.Sql;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    // Assumes migrations have already been run (locally: `pnpm db:migrate`;
    // in CI: the workflow's migrate step). The munin_app role must exist.
    // Connect as the non-superuser app role so RLS policies actually apply —
    // Postgres superusers always bypass RLS regardless of FORCE.
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    client = postgres(appUrl, { max: 2 });

    // Create two orgs in service-role mode (bypass via session-local GUC).
    await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
      const ts = Date.now();
      const a = await sql`
        INSERT INTO orgs (id, name, slug)
        VALUES ('org_test_a' || ${ts}, 'Org A', 'a-' || ${ts}::text)
        RETURNING id`;
      const b = await sql`
        INSERT INTO orgs (id, name, slug)
        VALUES ('org_test_b' || ${ts}, 'Org B', 'b-' || ${ts}::text)
        RETURNING id`;
      orgA = a[0]!.id as string;
      orgB = b[0]!.id as string;

      await sql`
        INSERT INTO end_users (id, org_id, external_id, name, metadata)
        VALUES ('eu_a_' || ${ts}, ${orgA}, 'a-eu-1', 'A user', '{}'),
               ('eu_b_' || ${ts}, ${orgB}, 'b-eu-1', 'B user', '{}')`;
    });
  });

  afterAll(async () => {
    if (!client) return;
    // Clean up
    await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
      await sql`DELETE FROM end_users WHERE org_id IN (${orgA}, ${orgB})`;
      await sql`DELETE FROM orgs WHERE id IN (${orgA}, ${orgB})`;
    });
    await client.end();
  });

  it('Org A scope sees only its own row', async () => {
    const rows = await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'off', true)`;
      await sql`SELECT set_config('app.org_id', ${orgA}, true)`;
      return sql<{ name: string }[]>`SELECT name FROM end_users WHERE name IN ('A user', 'B user')`;
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['A user']);
  });

  it('Org B scope sees only its own row', async () => {
    const rows = await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'off', true)`;
      await sql`SELECT set_config('app.org_id', ${orgB}, true)`;
      return sql<{ name: string }[]>`SELECT name FROM end_users WHERE name IN ('A user', 'B user')`;
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['B user']);
  });

  it('Org A cannot insert a row stamped for Org B', async () => {
    let threw = false;
    try {
      await client.begin(async (sql) => {
        await sql`SELECT set_config('app.bypass_rls', 'off', true)`;
        await sql`SELECT set_config('app.org_id', ${orgA}, true)`;
        await sql`
          INSERT INTO end_users (id, org_id, external_id, metadata)
          VALUES ('eu_spoof_' || ${Date.now()}::text, ${orgB}, 'spoof', '{}')`;
      });
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/row.level security|violates row-level security/i);
    }
    expect(threw).toBe(true);
  });

  it('bypass mode sees rows for all orgs', async () => {
    const rows = await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
      return sql<{ name: string }[]>`SELECT name FROM end_users WHERE name IN ('A user', 'B user')`;
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['A user', 'B user']);
  });

  it('delegated end-user scope further constrains visibility to that user', async () => {
    // Find Org A's eu id.
    const aEu = await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
      const rows = await sql`SELECT id FROM end_users WHERE org_id = ${orgA} LIMIT 1`;
      return rows[0]!.id as string;
    });

    const rows = await client.begin(async (sql) => {
      await sql`SELECT set_config('app.bypass_rls', 'off', true)`;
      await sql`SELECT set_config('app.org_id', ${orgA}, true)`;
      await sql`SELECT set_config('app.end_user_id', ${aEu}, true)`;
      return sql`SELECT id FROM end_users`;
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(aEu);
  });
});

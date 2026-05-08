/**
 * OSS migration entry point. Runs the shared schema (extensions, RLS,
 * module SQL, app role) from @getmunin/db, then layers the agent-host
 * singleton DDL on top.
 *
 *   pnpm --filter @getmunin/backend migrate
 *
 * Reads MUNIN_MIGRATE_URL (privileged superuser URL — not the runtime
 * munin_app role). Both halves are idempotent.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runMigrations } from '@getmunin/db';
import { AGENT_HOST_SINGLETON_DDL } from '@getmunin/agent-host';

async function main(): Promise<void> {
  const url = process.env.MUNIN_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('MUNIN_MIGRATE_URL (or DATABASE_URL) is required');
    process.exit(1);
  }

  await runMigrations(url);
  console.log('OSS schema applied');

  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    await db.execute(AGENT_HOST_SINGLETON_DDL);
    console.log('agent-host singleton DDL applied');
  } finally {
    await client.end();
  }
}

void main();

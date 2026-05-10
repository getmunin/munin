import './load-env.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runMigrations } from '@getmunin/db';
import { AGENT_HOST_SINGLETON_DDL } from '@getmunin/agent-host';

async function main(): Promise<void> {
  const targetUrl = process.env.MUNIN_TEST_MIGRATE_URL;
  if (!targetUrl) {
    console.error('MUNIN_TEST_MIGRATE_URL is required');
    process.exit(1);
  }

  const target = new URL(targetUrl);
  const targetDb = target.pathname.replace(/^\//, '');
  if (!targetDb) {
    console.error(`MUNIN_TEST_MIGRATE_URL must include a database name: ${targetUrl}`);
    process.exit(1);
  }

  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = '/postgres';

  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    const existing = await admin<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_database
      WHERE datname = ${targetDb}
    `;
    if (existing[0]?.count === '0') {
      await admin.unsafe(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`);
      console.log(`created database ${targetDb}`);
    } else {
      console.log(`database ${targetDb} already exists`);
    }
  } finally {
    await admin.end();
  }

  await runMigrations(targetUrl);
  console.log('OSS schema applied to test DB');

  const client = postgres(targetUrl, { max: 1 });
  try {
    const db = drizzle(client);
    await db.execute(AGENT_HOST_SINGLETON_DDL);
    console.log('agent-host singleton DDL applied to test DB');
  } finally {
    await client.end();
  }
}

void main();

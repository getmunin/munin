import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm', 'citext'];

/**
 * Run Drizzle migrations against the given Postgres connection string.
 *
 * Steps, in order:
 *   1. Ensure required Postgres extensions exist (pgvector, pg_trgm, citext).
 *   2. Apply Drizzle SQL migrations from packages/db/drizzle/.
 *   3. Apply RLS policies from packages/db/src/rls.sql.
 *
 * Idempotent: each step is safe to re-run.
 */
export async function runMigrations(connectionString: string, migrationsFolder?: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const folder = migrationsFolder ?? resolve(here, '..', 'drizzle');
  const rlsPath = resolve(here, 'rls.sql');

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  // 1. Extensions.
  for (const ext of REQUIRED_EXTENSIONS) {
    await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS ${ext};`));
  }

  // 2. Schema migrations.
  await migrate(db, { migrationsFolder: folder });

  // 3. RLS policies (idempotent SQL — every CREATE uses OR REPLACE / IF NOT EXISTS).
  const rlsSql = readFileSync(rlsPath, 'utf8');
  await db.execute(sql.raw(rlsSql));

  await client.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  await runMigrations(url);
  console.log('migrations applied');
}

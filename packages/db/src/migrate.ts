import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm', 'citext'];
const APP_ROLE = 'munin_app';

/**
 * Run Drizzle migrations against the given Postgres connection string.
 *
 * Steps, in order:
 *   1. Ensure required Postgres extensions exist (pgvector, pg_trgm, citext).
 *   2. Apply Drizzle SQL migrations from packages/db/drizzle/.
 *   3. Apply RLS policies from packages/db/src/rls.sql.
 *   4. Ensure a non-superuser application role `munin_app` exists with
 *      CRUD privileges on the public schema. Application traffic should
 *      connect as this role so RLS policies are enforced (Postgres
 *      superusers always bypass RLS by design, regardless of FORCE).
 *
 * Idempotent: each step is safe to re-run. Should be invoked with
 * credentials that can CREATE EXTENSION and CREATE ROLE — typically the
 * database owner or a superuser.
 */
export async function runMigrations(connectionString: string, migrationsFolder?: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const folder = migrationsFolder ?? resolve(here, '..', 'drizzle');
  const rlsPath = resolve(here, 'rls.sql');
  const kbPath = resolve(here, 'kb.sql');
  const deskPath = resolve(here, 'desk.sql');
  const crmPath = resolve(here, 'crm.sql');
  const cmsPath = resolve(here, 'cms.sql');

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  // 1. Extensions.
  for (const ext of REQUIRED_EXTENSIONS) {
    await client.unsafe(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
  }

  // 2. Schema migrations.
  await migrate(db, { migrationsFolder: folder });

  // 3. RLS policies and module post-migration SQL (FTS columns, HNSW indexes,
  //    per-module RLS, helper functions). postgres-js client.unsafe supports
  //    multi-statement scripts.
  await client.unsafe(readFileSync(rlsPath, 'utf8'));
  await client.unsafe(readFileSync(kbPath, 'utf8'));
  await client.unsafe(readFileSync(deskPath, 'utf8'));
  await client.unsafe(readFileSync(crmPath, 'utf8'));
  await client.unsafe(readFileSync(cmsPath, 'utf8'));

  // 4. App role (idempotent). Password defaults to the role name; override
  //    via MUNIN_APP_PASSWORD for non-dev deployments.
  const appPassword = process.env.MUNIN_APP_PASSWORD ?? APP_ROLE;
  await client.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD ${escapeSqlLiteral(appPassword)} NOSUPERUSER NOBYPASSRLS;
      ELSE
        ALTER ROLE ${APP_ROLE} WITH PASSWORD ${escapeSqlLiteral(appPassword)} NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
  `);

  await client.end();
}

function escapeSqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
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

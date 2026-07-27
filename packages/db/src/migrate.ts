import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm', 'citext', 'pgcrypto'];
const APP_ROLE = 'munin_app';

export async function runMigrations(connectionString: string, migrationsFolder?: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const folder = migrationsFolder ?? resolve(here, '..', 'drizzle');
  const sqlDir = resolve(here, 'sql');
  const rlsPath = resolve(sqlDir, 'rls.sql');
  const kbPath = resolve(sqlDir, 'kb.sql');
  const convPath = resolve(sqlDir, 'conv.sql');
  const crmPath = resolve(sqlDir, 'crm.sql');
  const cmsPath = resolve(sqlDir, 'cms.sql');
  const convChannelsPath = resolve(sqlDir, 'conv-channels.sql');
  const outreachPath = resolve(sqlDir, 'outreach.sql');
  const analyticsPath = resolve(sqlDir, 'analytics.sql');
  const slackPath = resolve(sqlDir, 'slack.sql');
  const connectorsPath = resolve(sqlDir, 'connectors.sql');

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  for (const ext of REQUIRED_EXTENSIONS) {
    await client.unsafe(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
  }

  await migrate(db, { migrationsFolder: folder });

  await client.unsafe(readFileSync(rlsPath, 'utf8'));
  await client.unsafe(readFileSync(kbPath, 'utf8'));
  await client.unsafe(readFileSync(convPath, 'utf8'));
  await client.unsafe(readFileSync(crmPath, 'utf8'));
  await client.unsafe(readFileSync(cmsPath, 'utf8'));
  await client.unsafe(readFileSync(convChannelsPath, 'utf8'));
  await client.unsafe(readFileSync(outreachPath, 'utf8'));
  await client.unsafe(readFileSync(analyticsPath, 'utf8'));
  await client.unsafe(readFileSync(slackPath, 'utf8'));
  await client.unsafe(readFileSync(connectorsPath, 'utf8'));

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
  const url = process.env.MUNIN_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('MUNIN_MIGRATE_URL or DATABASE_URL is required');
    process.exit(1);
  }
  await runMigrations(url);
  console.log('migrations applied');
}

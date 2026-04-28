import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export async function runMigrations(connectionString: string, migrationsFolder?: string) {
  const folder =
    migrationsFolder ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
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

/**
 * Seed a dev org + admin API key against MUNIN_MIGRATE_URL (or DATABASE_URL).
 *
 *   pnpm --filter @getmunin/backend exec tsx src/scripts/seed-dev.ts
 *
 * Prints the API key once. Save it; we don't store the plaintext.
 */
import { createDb, schema } from '@getmunin/db';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { sql } from 'drizzle-orm';

async function main() {
  const url = process.env.MUNIN_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Set MUNIN_MIGRATE_URL or DATABASE_URL.');
    process.exit(1);
  }
  const db = createDb(url);

  // Seed runs as the migration superuser, so RLS doesn't apply and we
  // freely create rows in any org. Still, set the bypass GUC to make
  // intent explicit.
  await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

  const [org] = await db
    .insert(schema.orgs)
    .values({ name: 'Local Dev Org' })
    .returning({ id: schema.orgs.id });

  const rawKey = buildApiKey('admin');
  await db.insert(schema.apiKeys).values({
    orgId: org!.id,
    type: 'admin',
    name: 'dev-seed',
    keyHash: hashSecret(rawKey),
    keyPrefix: keyPrefix(rawKey),
    scopes: ['*'],
  });

  console.log('');
  console.log('  ✓ Seeded org:        ', org!.id);
  console.log('  ✓ Created admin key: ', rawKey);
  console.log('');
  console.log('  Try it out:');
  console.log(`    curl -H "Authorization: Bearer ${rawKey}" http://localhost:3001/v1/whoami`);
  console.log('');

  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

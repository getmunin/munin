import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, schema } from '@getmunin/db';
import { AppModule } from '../src/app.module.ts';
import { InlineImageBackfillService } from '../src/modules/conv/attachments/inline-image-backfill.service.ts';

const BATCH = 100;
const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await app.init();
  const backfill = app.get(InlineImageBackfillService);
  const db = createDb(url);

  const orgRows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return tx.select({ id: schema.orgs.id, name: schema.orgs.name }).from(schema.orgs);
  });

  let totalMessages = 0;
  let totalImages = 0;

  for (const org of orgRows) {
    const runInOrg = <T>(fn: () => Promise<T>): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        await tx.execute(sql`SELECT set_config('app.org_id', ${org.id}, true)`);
        await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
        const actor = new ActorIdentity('system', 'inline-image-backfill', org.id, ['*'], ['admin']);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        return withContext(ctx, fn);
      });

    const remaining = await runInOrg(() => backfill.countRemaining());
    if (remaining === 0) continue;
    console.log(`org ${org.id} (${org.name}): ${remaining} message(s) with inlined images`);
    if (DRY_RUN) continue;

    for (;;) {
      const result = await runInOrg(() => backfill.run({ limit: BATCH }));
      if (result.converted === 0) {
        if (result.leftInline > 0) {
          console.log(
            `  ${result.leftInline} inlined image(s) intentionally left in place (too small, or not an accepted type)`,
          );
        }
        if (result.failed > 0) console.warn(`  ${result.failed} message(s) failed; see warnings`);
        break;
      }
      totalMessages += result.converted;
      totalImages += result.imagesExtracted;
      console.log(
        `  converted ${result.converted} message(s), extracted ${result.imagesExtracted} image(s)`,
      );
    }
  }

  if (DRY_RUN) {
    console.log('dry run: nothing was written');
  } else {
    console.log(`done: ${totalMessages} message(s) rewritten, ${totalImages} image(s) extracted`);
  }
  await app.close();
  process.exit(0);
}

await main();

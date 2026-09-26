import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { ActorIdentity, withContext } from '@getmunin/core';
import { eq, inArray, sql } from 'drizzle-orm';
import { createApp } from '../../bootstrap-app.ts';
import { AppModule } from '../../app.module.ts';
import { PiiAnnotationsService } from './pii-annotations.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run PII worker integration tests.';

const SECRET = 'pii-worker-secret-for-integration-tests';

interface Claimed {
  messageId: string;
  text: string;
}

(skipReason ? describe.skip : describe)('PII annotation worker API', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  const orgIds: string[] = [];
  const messageIds: string[] = [];

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    process.env.DATABASE_URL = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    for (const label of ['a', 'b']) {
      const [org] = await db.insert(schema.orgs).values({ name: `PII worker ${label}` }).returning();
      orgIds.push(org!.id);
      const [channel] = await db
        .insert(schema.convChannels)
        .values({ orgId: org!.id, type: 'email', vendor: 'mailer', name: 'Support' })
        .returning();
      const [conversation] = await db
        .insert(schema.convConversations)
        .values({ orgId: org!.id, displayId: 1, channelId: channel!.id })
        .returning();
      const inserted = await db
        .insert(schema.convMessages)
        .values([
          {
            orgId: org!.id,
            conversationId: conversation!.id,
            authorType: 'end_user',
            authorId: 'x',
            body: `Hei, jeg snakket med Per Olsen i går (${label}).`,
          },
          {
            orgId: org!.id,
            conversationId: conversation!.id,
            authorType: 'end_user',
            authorId: 'x',
            body: '🙂 Takk, Lise!',
          },
        ])
        .returning({ id: schema.convMessages.id });
      messageIds.push(...inserted.map((m) => m.id));
    }

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as { address(): AddressInfo | string | null }).address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    delete process.env.MUNIN_PII_NER_ENABLED;
    delete process.env.MUNIN_PII_WORKER_SECRET;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db && orgIds.length > 0) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(inArray(schema.orgs.id, orgIds));
    }
  });

  function enable(): void {
    process.env.MUNIN_PII_NER_ENABLED = '1';
    process.env.MUNIN_PII_WORKER_SECRET = SECRET;
  }

  async function post(path: string, body: unknown, secret = SECRET): Promise<Response> {
    return fetch(`${baseUrl}/v1/pii/annotations/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
  }

  async function claimAll(detectorVersion: number, holder: string): Promise<Claimed[]> {
    const mine: Claimed[] = [];
    for (let round = 0; round < 50; round += 1) {
      const res = await post('claim', { detectorVersion, holder, limit: 200 });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: Claimed[] };
      if (items.length === 0) break;
      mine.push(...items.filter((i) => messageIds.includes(i.messageId)));
    }
    return mine;
  }

  it('refuses every call while NER is not enabled', async () => {
    process.env.MUNIN_PII_WORKER_SECRET = SECRET;
    const res = await post('claim', { detectorVersion: 1, holder: 'w' });
    expect(res.status).toBe(503);
  });

  it('refuses a wrong secret', async () => {
    enable();
    const res = await post('claim', { detectorVersion: 1, holder: 'w' }, 'not-the-secret-at-all-nope');
    expect(res.status).toBe(401);
  });

  it('refuses a secret too short to be trusted, even when it matches', async () => {
    process.env.MUNIN_PII_NER_ENABLED = '1';
    process.env.MUNIN_PII_WORKER_SECRET = 'short';
    const res = await post('claim', { detectorVersion: 1, holder: 'w' }, 'short');
    expect(res.status).toBe(503);
  });

  it('claims across orgs, stores spans, and re-annotates on a version bump', async () => {
    enable();
    const claimed = await claimAll(1, 'worker-1');
    expect(claimed.map((c) => c.messageId).sort()).toEqual([...messageIds].sort());

    expect(await claimAll(1, 'worker-2')).toEqual([]);

    const perOlsen = claimed.find((c) => c.text.includes('Per Olsen'))!;
    const lise = claimed.find((c) => c.text.includes('Lise'))!;
    const pythonOffset = [...lise.text].length - [...'Lise!'].length;

    const wrongHolder = await post('submit', {
      holder: 'worker-2',
      detectorVersion: 1,
      detector: 'test',
      results: [{ messageId: perOlsen.messageId, spans: [] }],
    });
    expect(((await wrongHolder.json()) as { rejected: unknown[] }).rejected).toEqual([
      { messageId: perOlsen.messageId, reason: 'lease_lost' },
    ]);

    const res = await post('submit', {
      holder: 'worker-1',
      detectorVersion: 1,
      detector: 'test',
      results: claimed.map((c) =>
        c.messageId === perOlsen.messageId
          ? {
              messageId: c.messageId,
              spans: [
                { start: c.text.indexOf('Per Olsen'), end: c.text.indexOf('Per Olsen') + 9, text: 'Per Olsen', source: 'spacy' },
              ],
            }
          : c.messageId === lise.messageId
            ? {
                messageId: c.messageId,
                spans: [{ start: pythonOffset, end: pythonOffset + 4, text: 'Lise', label: 'PER', source: 'gliner' }],
              }
            : { messageId: c.messageId, spans: [{ start: 0, end: 3, text: 'Nobody', source: 'spacy' }] },
      ),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; spans: number };
    expect(body.accepted).toBe(messageIds.length);

    const spans = await db
      .select()
      .from(schema.piiSpans)
      .where(inArray(schema.piiSpans.messageId, messageIds));
    const liseSpan = spans.find((s) => s.messageId === lise.messageId)!;
    expect(lise.text.slice(liseSpan.startOffset, liseSpan.endOffset)).toBe('Lise');
    expect(spans.filter((s) => s.surface === 'Nobody')).toEqual([]);
    expect(spans.find((s) => s.messageId === perOlsen.messageId)?.surface).toBe('Per Olsen');

    expect(await claimAll(1, 'worker-1')).toEqual([]);

    const upgraded = await claimAll(2, 'worker-v2');
    expect(upgraded).toHaveLength(messageIds.length);

    const stale = await post('submit', {
      holder: 'worker-1',
      detectorVersion: 1,
      detector: 'test',
      results: [{ messageId: perOlsen.messageId, spans: [] }],
    });
    expect(((await stale.json()) as { rejected: unknown[] }).rejected).toHaveLength(1);

    await post('submit', {
      holder: 'worker-v2',
      detectorVersion: 2,
      detector: 'test-v2',
      results: upgraded.map((c) => ({ messageId: c.messageId, spans: [] })),
    });
    const after = await db
      .select()
      .from(schema.piiSpans)
      .where(inArray(schema.piiSpans.messageId, messageIds));
    expect(after).toEqual([]);
    const [annotation] = await db
      .select()
      .from(schema.piiMessageAnnotations)
      .where(eq(schema.piiMessageAnnotations.messageId, perOlsen.messageId));
    expect(annotation?.nerVersion).toBe(2);
    expect(annotation?.leaseHolder).toBeNull();
  });

  it('reports coverage only for the messages the calling org can see', async () => {
    const service = app.get(PiiAnnotationsService);
    const actor = new ActorIdentity('system', 'coverage-test', orgIds[0]!, ['*'], ['admin']);
    const appDb = createDb(process.env.DATABASE_URL!, { serviceRole: true });
    const coverage = await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgIds[0]!}, true)`);
      return withContext({ db: tx, actor, correlationId: randomUUID() }, () =>
        service.coverage([...messageIds, 'cvm_unknown']),
      );
    });
    expect(coverage).toEqual({ total: messageIds.length + 1, annotated: 2 });
  });
});

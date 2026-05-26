import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to run curator-jobs integration tests.';

(skipReason ? describe.skip : describe)('curator_jobs queue', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let adminKey: string;
  let otherAdminKey: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);

    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Curator Q Org' })
      .returning();
    orgId = org!.id;

    const [otherOrg] = await db
      .insert(schema.orgs)
      .values({ name: 'Curator Q Other Org' })
      .returning();
    otherOrgId = otherOrg!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'cjq-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    otherAdminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId: otherOrgId,
      type: 'admin',
      name: 'cjq-other-admin',
      keyHash: hashSecret(otherAdminKey),
      keyPrefix: keyPrefix(otherAdminKey),
      scopes: ['*'],
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM curator_jobs`);
  });

  async function call(
    path: string,
    init: { method?: string; body?: unknown; key?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${init.key ?? adminKey}`,
        'content-type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }

  it('enqueues a job, claims it, and acks it', async () => {
    const enq = await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: {
        jobUri: 'skill://kb/review-content',
        userPrompt: 'Run a KB curation pass for ccv_x',
        sourceEventType: 'conversation.handover_resolved',
        sourceEventPayload: { conversationId: 'ccv_x', messageId: 'cvm_x', authorType: 'user' },
        dedupeKey: 'kb-curation:msg:cvm_x',
      },
    });
    expect(enq.status).toBe(201);
    const enqBody = enq.body as { job: { id: string; status: string }; alreadyPending: boolean };
    expect(enqBody.alreadyPending).toBe(false);
    expect(enqBody.job.status).toBe('pending');

    const claim = await call('/api/v1/curation/jobs/claim', {
      method: 'POST',
      body: { holder: 'sidecar-test', limit: 5, leaseSeconds: 60 },
    });
    expect(claim.status).toBe(200);
    const claimBody = claim.body as { items: Array<{ id: string; attempts: number; leaseHolder: string | null }> };
    expect(claimBody.items).toHaveLength(1);
    expect(claimBody.items[0]?.id).toBe(enqBody.job.id);
    expect(claimBody.items[0]?.attempts).toBe(1);
    expect(claimBody.items[0]?.leaseHolder).toBe('sidecar-test');

    const ack = await call(`/api/v1/curation/jobs/${enqBody.job.id}/ack`, {
      method: 'POST',
      body: { replyText: 'done', toolCalls: 3, totalTokens: 200 },
    });
    expect(ack.status).toBe(200);
    const ackBody = ack.body as { status: string; lastReplyText: string; lastToolCalls: number };
    expect(ackBody.status).toBe('done');
    expect(ackBody.lastReplyText).toBe('done');
    expect(ackBody.lastToolCalls).toBe(3);

    const reclaim = await call('/api/v1/curation/jobs/claim', {
      method: 'POST',
      body: { holder: 'sidecar-test' },
    });
    const reclaimBody = reclaim.body as { items: unknown[] };
    expect(reclaimBody.items).toHaveLength(0);
  });

  it('returns existing job when same dedupeKey is enqueued twice', async () => {
    const first = await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: {
        jobUri: 'skill://kb/review-content',
        userPrompt: 'pass A',
        dedupeKey: 'kb-curation:msg:cvm_dup',
      },
    });
    const firstBody = first.body as { job: { id: string }; alreadyPending: boolean };
    expect(firstBody.alreadyPending).toBe(false);

    const second = await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: {
        jobUri: 'skill://kb/review-content',
        userPrompt: 'pass B (should be ignored)',
        dedupeKey: 'kb-curation:msg:cvm_dup',
      },
    });
    const secondBody = second.body as { job: { id: string; userPrompt: string }; alreadyPending: boolean };
    expect(secondBody.alreadyPending).toBe(true);
    expect(secondBody.job.id).toBe(firstBody.job.id);
    expect(secondBody.job.userPrompt).toBe('pass A');
  });

  it('fail with retryable=true bumps next_attempt_at and stays pending', async () => {
    const enq = await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: { jobUri: 'skill://kb/review-content', userPrompt: 'will fail' },
    });
    const job = (enq.body as { job: { id: string } }).job;

    await call('/api/v1/curation/jobs/claim', {
      method: 'POST',
      body: { holder: 'sidecar-test' },
    });

    const fail = await call(`/api/v1/curation/jobs/${job.id}/fail`, {
      method: 'POST',
      body: { error: 'transient network error', retryable: true },
    });
    const failBody = fail.body as { status: string; nextAttemptAt: string; lastError: string; attempts: number };
    expect(failBody.status).toBe('pending');
    expect(failBody.lastError).toBe('transient network error');
    expect(failBody.attempts).toBe(1);
    expect(new Date(failBody.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 10_000);
  });

  it('fail with retryable=false marks the job failed (not retried)', async () => {
    const enq = await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: { jobUri: 'skill://kb/review-content', userPrompt: 'permanent fail' },
    });
    const job = (enq.body as { job: { id: string } }).job;

    await call('/api/v1/curation/jobs/claim', {
      method: 'POST',
      body: { holder: 'sidecar-test' },
    });

    const fail = await call(`/api/v1/curation/jobs/${job.id}/fail`, {
      method: 'POST',
      body: { error: 'skill missing', retryable: false },
    });
    expect((fail.body as { status: string }).status).toBe('failed');

    const reclaim = await call('/api/v1/curation/jobs/claim', {
      method: 'POST',
      body: { holder: 'sidecar-test' },
    });
    expect((reclaim.body as { items: unknown[] }).items).toHaveLength(0);
  });

  it('retryable fail beyond maxAttempts marks the job dead', async () => {
    const enq = await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: { jobUri: 'skill://kb/review-content', userPrompt: 'eventual dead', maxAttempts: 2 },
    });
    const job = (enq.body as { job: { id: string } }).job;

    await db
      .update(schema.curatorJobs)
      .set({ attempts: 2, leaseExpiresAt: null, leaseHolder: null })
      .where(sql`id = ${job.id}`);

    const fail = await call(`/api/v1/curation/jobs/${job.id}/fail`, {
      method: 'POST',
      body: { error: 'still broken', retryable: true },
    });
    expect((fail.body as { status: string }).status).toBe('dead');
  });

  it('isolates jobs across orgs (RLS)', async () => {
    await call('/api/v1/curation/jobs', {
      method: 'POST',
      body: { jobUri: 'skill://kb/review-content', userPrompt: 'org A job' },
    });

    const otherList = await call('/api/v1/curation/jobs', { key: otherAdminKey });
    expect((otherList.body as { items: unknown[] }).items).toHaveLength(0);

    const otherClaim = await call('/api/v1/curation/jobs/claim', {
      method: 'POST',
      key: otherAdminKey,
      body: { holder: 'sidecar-other' },
    });
    expect((otherClaim.body as { items: unknown[] }).items).toHaveLength(0);
  });
});

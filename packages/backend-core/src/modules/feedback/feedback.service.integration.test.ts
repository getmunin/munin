import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ActorIdentity, withContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import {
  FeedbackDecidedError,
  FeedbackForwardFailedError,
  FeedbackNotFoundError,
  FeedbackService,
  type FeedbackEventEmitter,
  type FeedbackIntake,
} from './feedback.service.ts';
import type { ForwardResult, PublicFeedbackItem, VoteResult } from './feedback.forwarder.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run feedback service tests.';

(skipReason ? describe.skip : describe)('FeedbackService keeps decided items', () => {
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let service: FeedbackService;
  let nextForward: ForwardResult;
  let emitted: string[];

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Feedback Org' }).returning();
    orgId = org!.id;

    const forwarder: FeedbackIntake = {
      forward: () => Promise.resolve(nextForward),
      search: (): Promise<PublicFeedbackItem[]> => Promise.resolve([]),
      vote: (): Promise<VoteResult> => Promise.resolve({ voteCount: 0, alreadyVoted: false }),
    };
    const webhooks: FeedbackEventEmitter = {
      emit: (event) => {
        emitted.push(event.type);
        return Promise.resolve(event.type);
      },
    };
    service = new FeedbackService(forwarder, webhooks);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      if (orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    }
  });

  beforeEach(() => {
    nextForward = { ok: true, permanent: false, status: 200 };
    emitted = [];
  });

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity('user', 'usr_reviewer', orgId, ['*'], ['admin']);
    return withContext({ db, actor, correlationId: 'test' }, fn);
  }

  async function submit(title: string): Promise<string> {
    const item = await asAdmin(() => service.create({ title, body: 'A body long enough.' }));
    return item.id;
  }

  async function rowOf(id: string) {
    const rows = await db
      .select()
      .from(schema.feedbackOutbox)
      .where(eq(schema.feedbackOutbox.id, id));
    return rows[0];
  }

  it('keeps a dismissed item with its reason and decider', async () => {
    const id = await submit('Dismiss me');
    await asAdmin(() => service.dismiss(id, 'Already on the roadmap'));

    const row = await rowOf(id);
    expect(row?.status).toBe('dismissed');
    expect(row?.dismissReason).toBe('Already on the roadmap');
    expect(row?.decidedByActorType).toBe('user');
    expect(row?.decidedByActorId).toBe('usr_reviewer');
    expect(row?.decidedAt).not.toBeNull();
    expect(emitted).toContain('feedback.item.dismissed');
  });

  it('keeps a forwarded item as approved instead of deleting it', async () => {
    const id = await submit('Forward me');
    await asAdmin(() => service.approve(id));

    const row = await rowOf(id);
    expect(row?.status).toBe('approved');
    expect(row?.sentAt).not.toBeNull();
    expect(row?.forwardError).toBeNull();
    expect(row?.decidedByActorId).toBe('usr_reviewer');
    expect(emitted).toContain('feedback.item.approved');
  });

  it('drops a decided item out of the pending list so it is never forwarded twice', async () => {
    const approved = await submit('Approved one');
    const dismissed = await submit('Dismissed one');
    const waiting = await submit('Still waiting');
    await asAdmin(() => service.approve(approved));
    await asAdmin(() => service.dismiss(dismissed));

    const pending = await asAdmin(() => service.listPending());
    const ids = pending.map((i) => i.id);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(approved);
    expect(ids).not.toContain(dismissed);
  });

  it('refuses to decide the same item twice', async () => {
    const id = await submit('Decide once');
    await asAdmin(() => service.approve(id));

    await expect(asAdmin(() => service.approve(id))).rejects.toBeInstanceOf(FeedbackDecidedError);
    await expect(asAdmin(() => service.dismiss(id))).rejects.toBeInstanceOf(FeedbackDecidedError);
  });

  it('leaves a failed forward pending so the retry still finds it', async () => {
    const id = await submit('Intake is down');
    nextForward = { ok: false, permanent: false, status: 502, error: 'bad gateway' };

    await expect(asAdmin(() => service.approve(id))).rejects.toBeInstanceOf(
      FeedbackForwardFailedError,
    );

    const row = await rowOf(id);
    expect(row?.status).toBe('pending');
    expect(row?.forwardError).toContain('502');
    expect(emitted).not.toContain('feedback.item.approved');

    const pending = await asAdmin(() => service.listPending());
    expect(pending.map((i) => i.id)).toContain(id);
  });

  it('reports a missing item as not found', async () => {
    await expect(asAdmin(() => service.dismiss('fb_nope'))).rejects.toBeInstanceOf(
      FeedbackNotFoundError,
    );
  });
});

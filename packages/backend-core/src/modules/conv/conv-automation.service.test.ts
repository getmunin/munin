import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { ConvAutomationService } from './conv-automation.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run conv automation tests.';

(skipReason ? describe.skip : describe)('ConvAutomationService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: ConvAutomationService;
  let orgId: string;
  let actor: ActorIdentity;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    const [org] = await db.insert(schema.orgs).values({ name: 'Conv Automation Test Org' }).returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_automation_test', orgId, ['*'], ['admin']);
    svc = new ConvAutomationService(new WebhookDispatcher());
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM conv_messages WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_topics WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_channels WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
  });

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function seedTopicWithHistory() {
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: `auto-${randomUUID().slice(0, 8)}` })
      .returning();
    const [topic] = await db
      .insert(schema.convTopics)
      .values({ orgId, name: 'Document requests', slug: `docs-${randomUUID().slice(0, 8)}` })
      .returning();
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: Math.floor(Math.random() * 1_000_000),
        channelId: channel!.id,
        topicId: topic!.id,
        status: 'open',
      })
      .returning();
    const messages = [
      { authorType: 'end_user', internal: false, metadata: {} },
      { authorType: 'agent', internal: false, metadata: {} },
      { authorType: 'user', internal: false, metadata: { approvedDraft: { edited: false } } },
      { authorType: 'user', internal: false, metadata: { approvedDraft: { edited: false } } },
      { authorType: 'user', internal: false, metadata: { approvedDraft: { edited: true } } },
      { authorType: 'agent', internal: true, metadata: { kind: 'draft_reply_rejected' } },
    ];
    for (const m of messages) {
      await db.insert(schema.convMessages).values({
        orgId,
        conversationId: conv!.id,
        authorType: m.authorType,
        authorId: 'seed',
        body: 'seeded',
        internal: m.internal,
        metadata: m.metadata,
      });
    }
    return { topic: topic!, conv: conv! };
  }

  it('counts approved, edited, rejected and auto-sent replies per topic', async () => {
    const { topic } = await seedTopicWithHistory();
    const summary = await run(() => svc.listTopicAutomation());
    const row = summary.topics.find((t) => t.id === topic.id);
    expect(row).toBeDefined();
    expect(row!.approvedUnedited).toBe(2);
    expect(row!.edited).toBe(1);
    expect(row!.rejected).toBe(1);
    expect(row!.autoSent).toBe(1);
    expect(row!.reviewedCount).toBe(4);
    expect(row!.agentMode).toBeNull();
    expect(summary.autoRate7d).toBe(0.25);
  });

  it('promoting stamps auto_promoted_at once and demoting clears it', async () => {
    const { topic } = await seedTopicWithHistory();
    const promoted = await run(() => svc.setTopicAgentMode({ topicId: topic.id, mode: 'auto' }));
    expect(promoted.agentMode).toBe('auto');
    expect(promoted.autoPromotedAt).toBeTruthy();
    const rePromoted = await run(() => svc.setTopicAgentMode({ topicId: topic.id, mode: 'auto' }));
    expect(rePromoted.autoPromotedAt).toBe(promoted.autoPromotedAt);
    const demoted = await run(() => svc.setTopicAgentMode({ topicId: topic.id, mode: 'draft_only' }));
    expect(demoted.agentMode).toBe('draft_only');
    expect(demoted.autoPromotedAt).toBeNull();
    const cleared = await run(() => svc.setTopicAgentMode({ topicId: topic.id, mode: null }));
    expect(cleared.agentMode).toBeNull();
    const types = await db.execute<{ type: string }>(
      sql`SELECT type FROM events WHERE org_id = ${orgId} ORDER BY created_at`,
    );
    expect(types.filter((r) => r.type === 'conversation.topic_automation_changed')).toHaveLength(4);
  });

  it('rejects an unknown topic before writing anything', async () => {
    await expect(
      run(() => svc.setTopicAgentMode({ topicId: 'ctp_missing', mode: 'auto' })),
    ).rejects.toThrow(NotFoundException);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { raiseAttentionWhenAgentIsOff } from './unanswerable-handover.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run unanswerable-handover tests.';

(skipReason ? describe.skip : describe)('raiseAttentionWhenAgentIsOff', () => {
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let channelId: string;

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'Unanswerable Test Org' }).returning();
    orgId = org!.id;
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'widget' })
      .returning();
    channelId = channel!.id;
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM conv_topics WHERE org_id = ${orgId}`);
  });

  async function seedConversation(opts: {
    convMode: 'auto' | 'draft_only' | 'off';
    topicMode?: 'auto' | 'draft_only' | 'off' | null;
    status?: 'open' | 'closed';
    alreadyFlagged?: boolean;
  }) {
    let topicId: string | null = null;
    if (opts.topicMode !== undefined) {
      const [topic] = await db
        .insert(schema.convTopics)
        .values({
          orgId,
          name: 'Topic',
          slug: `t-${randomUUID().slice(0, 8)}`,
          agentMode: opts.topicMode,
        })
        .returning();
      topicId = topic!.id;
    }
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: Math.floor(Math.random() * 1_000_000),
        channelId,
        topicId,
        status: opts.status ?? 'open',
        agentMode: opts.convMode,
        needsHumanAttention: opts.alreadyFlagged ?? false,
        ...(opts.alreadyFlagged ? { needsHumanAttentionAt: new Date('2020-01-01T00:00:00Z') } : {}),
      })
      .returning();
    return conv!;
  }

  async function readFlag(id: string) {
    const rows = await db.execute<{
      needs_human_attention: boolean;
      needs_human_attention_at: string | Date | null;
      handover_resolved_at: string | Date | null;
    }>(
      sql`SELECT needs_human_attention, needs_human_attention_at, handover_resolved_at
          FROM conv_conversations WHERE id = ${id}`,
    );
    return rows[0]!;
  }

  it('flags a conversation whose topic turns the agent off, because nothing else will answer', async () => {
    const conv = await seedConversation({ convMode: 'auto', topicMode: 'off' });
    expect(await raiseAttentionWhenAgentIsOff(db, conv.id)).toBe(true);
    const after = await readFlag(conv.id);
    expect(after.needs_human_attention).toBe(true);
    expect(after.needs_human_attention_at).toBeTruthy();
    expect(after.handover_resolved_at).toBeNull();
  });

  it('flags a conversation set to off with no topic override', async () => {
    const conv = await seedConversation({ convMode: 'off' });
    expect(await raiseAttentionWhenAgentIsOff(db, conv.id)).toBe(true);
    expect((await readFlag(conv.id)).needs_human_attention).toBe(true);
  });

  it('leaves auto and draft_only alone, since the agent still produces a reply', async () => {
    const auto = await seedConversation({ convMode: 'auto', topicMode: 'auto' });
    const draft = await seedConversation({ convMode: 'draft_only', topicMode: 'draft_only' });
    expect(await raiseAttentionWhenAgentIsOff(db, auto.id)).toBe(false);
    expect(await raiseAttentionWhenAgentIsOff(db, draft.id)).toBe(false);
    expect((await readFlag(auto.id)).needs_human_attention).toBe(false);
    expect((await readFlag(draft.id)).needs_human_attention).toBe(false);
  });

  it('lets a topic override rescue a conversation its own mode had turned off', async () => {
    const conv = await seedConversation({ convMode: 'off', topicMode: 'draft_only' });
    expect(await raiseAttentionWhenAgentIsOff(db, conv.id)).toBe(false);
    expect((await readFlag(conv.id)).needs_human_attention).toBe(false);
  });

  it('does not reset the original attention timestamp when already flagged', async () => {
    const conv = await seedConversation({
      convMode: 'off',
      topicMode: 'off',
      alreadyFlagged: true,
    });
    expect(await raiseAttentionWhenAgentIsOff(db, conv.id)).toBe(false);
    const after = await readFlag(conv.id);
    expect(after.needs_human_attention).toBe(true);
    expect(new Date(after.needs_human_attention_at!).toISOString()).toBe(
      '2020-01-01T00:00:00.000Z',
    );
  });

  it('ignores a closed conversation', async () => {
    const conv = await seedConversation({ convMode: 'off', topicMode: 'off', status: 'closed' });
    expect(await raiseAttentionWhenAgentIsOff(db, conv.id)).toBe(false);
    expect((await readFlag(conv.id)).needs_human_attention).toBe(false);
  });
});

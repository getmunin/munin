import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { ActorIdentity, WebhookDispatcher, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackBridgeWorker } from './slack-bridge.worker.ts';
import { SlackEventSink } from './slack-event-sink.ts';
import { encryptSecretValue } from './slack.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run slack CMS publish tests.';

class FakeSlackApi extends SlackApiClient {
  posted: { channel: string; text: string; threadTs?: string; ts: string }[] = [];
  private counter = 0;

  override postMessage(input: {
    token: string;
    channel: string;
    text: string;
    threadTs?: string;
  }): Promise<{ ts: string; channel: string }> {
    this.counter += 1;
    const ts = `${Math.floor(Date.now() / 1000)}.${String(this.counter).padStart(6, '0')}`;
    this.posted.push({
      channel: input.channel,
      text: input.text,
      threadTs: input.threadTs,
      ts,
    });
    return Promise.resolve({ ts, channel: input.channel });
  }
}

(skipReason ? describe.skip : describe)('Slack CMS publish announcements', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let integrationId: string;
  let actor: ActorIdentity;
  let dispatcher: WebhookDispatcher;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'slack-cms-publish-test-encryption-key';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    appDb = createDb(appUrl);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Slack CMS Publish Test Org' })
      .returning();
    orgId = org!.id;
    actor = new ActorIdentity('admin_agent', 'agt_cms_publish_test', orgId, ['*'], ['admin']);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.delete(schema.slackIntegrations).where(eq(schema.slackIntegrations.orgId, orgId));
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);

    const encryptedBotToken = await encryptSecretValue(db, 'xoxb-cms-publish-token');
    const [integration] = await db
      .insert(schema.slackIntegrations)
      .values({ orgId, teamId: 'T_CMS', teamName: 'Contentspace', encryptedBotToken })
      .returning();
    integrationId = integration!.id;
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_CMS',
      slackChannelId: 'C_DEFAULT',
      purpose: 'default',
    });

    dispatcher = new WebhookDispatcher();
    dispatcher.registerSink(new SlackEventSink());
  });

  function emit(payload: Record<string, unknown>): Promise<string> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, () =>
        dispatcher.emit({ type: 'cms.entry.published', payload }),
      );
    });
  }

  function publishedPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      entryId: `cme_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      collectionSlug: 'blog',
      slug: 'spring-menu',
      locale: 'nb',
      translationGroupId: `cmg_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      status: 'published',
      version: 3,
      previousStatus: 'draft',
      title: 'Spring menu is here',
      url: 'https://www.example.com/nb/blog/spring-menu',
      ...over,
    };
  }

  async function deliveries() {
    return await db
      .select()
      .from(schema.slackDeliveries)
      .where(eq(schema.slackDeliveries.integrationId, integrationId));
  }

  it('announces a publish in the default channel with the live article link', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const payload = publishedPayload();

    await emit(payload);

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.conversationId).toBeNull();
    expect(rows[0]!.subjectKey).toBe(`cms_entry:${payload.entryId as string}`);

    const result = await worker.tick();
    expect(result.delivered).toBe(1);
    expect(api.posted).toHaveLength(1);
    expect(api.posted[0]!.channel).toBe('C_DEFAULT');
    expect(api.posted[0]!.threadTs).toBeUndefined();
    expect(api.posted[0]!.text).toContain('*Spring menu is here*');
    expect(api.posted[0]!.text).toContain('_blog · nb_');
    expect(api.posted[0]!.text).toContain(
      '<https://www.example.com/nb/blog/spring-menu|Read it live>',
    );
  });

  it('prefers a content route over the default channel', async () => {
    await db.insert(schema.slackChannelRoutes).values({
      orgId,
      integrationId,
      teamId: 'T_CMS',
      slackChannelId: 'C_CONTENT',
      purpose: 'content',
    });
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);

    await emit(publishedPayload());
    await worker.tick();

    expect(api.posted.map((p) => p.channel)).toEqual(['C_CONTENT']);
  });

  it('announces without a link when the collection has no live URL template', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);

    await emit(publishedPayload({ url: null }));
    await worker.tick();

    expect(api.posted).toHaveLength(1);
    expect(api.posted[0]!.text).not.toContain('Read it live');
  });

  it('falls back to the slug when the entry has no title field', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);

    await emit(publishedPayload({ title: 'spring-menu' }));
    await worker.tick();

    expect(api.posted[0]!.text).toContain('*spring-menu*');
  });

  it('threads the other locales of one article under the locale that published first', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const group = 'cmg_spring_menu';

    await emit(
      publishedPayload({ translationGroupId: group, locale: 'nb', title: 'Vårmeny' }),
    );
    await worker.tick();
    await emit(
      publishedPayload({ translationGroupId: group, locale: 'da', title: 'Forårsmenu' }),
    );
    await emit(
      publishedPayload({ translationGroupId: group, locale: 'sv', title: 'Vårmeny' }),
    );
    await worker.tick();

    expect(api.posted).toHaveLength(3);
    expect(api.posted[0]!.threadTs).toBeUndefined();
    expect(api.posted[1]!.threadTs).toBe(api.posted[0]!.ts);
    expect(api.posted[2]!.threadTs).toBe(api.posted[0]!.ts);
    expect(api.posted.map((p) => p.channel)).toEqual(['C_DEFAULT', 'C_DEFAULT', 'C_DEFAULT']);

    const links = await db
      .select()
      .from(schema.slackNotificationLinks)
      .where(eq(schema.slackNotificationLinks.integrationId, integrationId));
    expect(links).toHaveLength(1);
    expect(links[0]!.subjectType).toBe('cms_translation_group');
    expect(links[0]!.subjectId).toBe(group);
  });

  it('keeps separate articles in separate channel messages', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);

    await emit(publishedPayload({ translationGroupId: 'cmg_one' }));
    await emit(publishedPayload({ translationGroupId: 'cmg_two' }));
    await worker.tick();

    expect(api.posted).toHaveLength(2);
    expect(api.posted.every((p) => p.threadTs === undefined)).toBe(true);
  });

  it('starts a fresh channel message when the article last published on an earlier day', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);
    const group = 'cmg_stale';

    await emit(publishedPayload({ translationGroupId: group }));
    await worker.tick();
    const yesterday = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
    await db
      .update(schema.slackNotificationLinks)
      .set({ slackTs: `${yesterday}.000100` })
      .where(eq(schema.slackNotificationLinks.subjectId, group));

    await emit(publishedPayload({ translationGroupId: group, locale: 'da' }));
    await worker.tick();

    expect(api.posted).toHaveLength(2);
    expect(api.posted[1]!.threadTs).toBeUndefined();
    const links = await db
      .select()
      .from(schema.slackNotificationLinks)
      .where(eq(schema.slackNotificationLinks.subjectId, group));
    expect(links).toHaveLength(1);
    expect(links[0]!.slackTs).toBe(api.posted[1]!.ts);
  });

  it('posts at channel level when the payload carries no translation group', async () => {
    const api = new FakeSlackApi();
    const worker = new SlackBridgeWorker(db, api);

    await emit(publishedPayload({ translationGroupId: undefined }));
    await worker.tick();

    expect(api.posted[0]!.threadTs).toBeUndefined();
    const links = await db
      .select()
      .from(schema.slackNotificationLinks)
      .where(eq(schema.slackNotificationLinks.integrationId, integrationId));
    expect(links).toHaveLength(0);
  });

  it('does not enqueue anything when the entry was already published', async () => {
    await emit(publishedPayload({ previousStatus: 'published' }));

    expect(await deliveries()).toHaveLength(0);
  });

  it('does not enqueue anything when the org has no Slack integration', async () => {
    await db.delete(schema.slackIntegrations).where(eq(schema.slackIntegrations.orgId, orgId));

    await emit(publishedPayload());

    expect(await deliveries()).toHaveLength(0);
  });
});

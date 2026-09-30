import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  ActorIdentity,
  WebhookDispatcher,
  getCurrentContext,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConvTranslationService } from './conv-translation.service.ts';
import { ConvService } from './conv.service.ts';
import { ConversationClaimsService } from './conv.claims.service.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { stubAttachmentGateway } from './attachments/conv-attachments.test-stub.ts';
import { MessageTranslatorRegistry, type TranslateTextInput } from './message-translator.ts';
import {
  deleteMessageTranslations,
  normalizeLanguageTag,
  sameLanguage,
} from './translation-helpers.ts';

describe('language tags', () => {
  it('normalizes case and underscores', () => {
    expect(normalizeLanguageTag(' pt_BR ')).toBe('pt-br');
  });

  it('rejects anything that is not a language tag', () => {
    expect(() => normalizeLanguageTag('spanish please')).toThrow(BadRequestException);
  });

  it('treats the Norwegian written standards as one language', () => {
    expect(sameLanguage('nb', 'no')).toBe(true);
    expect(sameLanguage('nn', 'nb')).toBe(true);
    expect(sameLanguage('pt-br', 'pt')).toBe(true);
    expect(sameLanguage('es', 'nb')).toBe(false);
  });
});

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run translation service tests.';

(skipReason ? describe.skip : describe)('ConvTranslationService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let svc: ConvTranslationService;
  let orgId: string;
  let otherOrgId: string;
  let channelId: string;
  let endUserId: string;
  let actor: ActorIdentity;
  let teammate: ActorIdentity;
  let userId: string;
  let translatorCalls: TranslateTextInput[];
  let translatorReply: (input: TranslateTextInput) => Promise<string>;
  const registry = new MessageTranslatorRegistry();

  beforeAll(async () => {
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);
    const [org] = await db.insert(schema.orgs).values({ name: 'Translation Test Org' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'Translation Other Org' }).returning();
    otherOrgId = other!.id;
    const [channel] = await db
      .insert(schema.convChannels)
      .values({ orgId, type: 'chat', vendor: 'munin', name: 'Widget' })
      .returning();
    channelId = channel!.id;
    const [endUser] = await db
      .insert(schema.endUsers)
      .values({ orgId, externalId: `translation-${Date.now()}`, name: 'Juan Pérez' })
      .returning();
    endUserId = endUser!.id;
    actor = new ActorIdentity('admin_agent', 'agt_translation_test', orgId, ['*'], ['admin']);
    const [user] = await db
      .insert(schema.users)
      .values({ email: `translation-${Date.now()}@example.com`, name: 'Kari Nordmann' })
      .returning();
    userId = user!.id;
    await db.insert(schema.orgMembers).values({ orgId, userId });
    teammate = new ActorIdentity('user', userId, orgId, ['*'], ['admin']);
    const dispatcher = new WebhookDispatcher();
    const conv = new ConvService(
      dispatcher,
      new ConversationClaimsService(dispatcher),
      new CuratorJobsService(dispatcher),
      new AlertsService(dispatcher),
      stubAttachmentGateway(),
    );
    registry.register({
      translateText: (input) => {
        translatorCalls.push(input);
        return translatorReply(input);
      },
    });
    svc = new ConvTranslationService(dispatcher, conv, registry);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
      await db.delete(schema.users).where(sql`id = ${userId}`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM conv_conversations WHERE org_id = ${orgId}`);
    await db.execute(sql`DELETE FROM events WHERE org_id = ${orgId}`);
    translatorCalls = [];
    translatorReply = (input) => Promise.resolve(`[${input.targetLanguage}] ${input.text}`);
  });

  function run<T>(
    fn: () => Promise<T>,
    runAs: ActorIdentity = actor,
    endUser = '',
  ): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${runAs.orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', ${endUser}, true)`);
      const ctx: RequestContext = { db: tx, actor: runAs, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function seedConversation(customerLanguage: string | null = null) {
    const [conv] = await db
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId: Math.floor(Math.random() * 1_000_000),
        channelId,
        endUserId,
        customerLanguage,
      })
      .returning();
    const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 12, 0, s));
    const messages = await db
      .insert(schema.convMessages)
      .values([
        { orgId, conversationId: conv!.id, authorType: 'end_user', authorId: endUserId, body: 'Hola, ¿dónde está mi pedido?', createdAt: at(1) },
        { orgId, conversationId: conv!.id, authorType: 'agent', authorId: 'agent', body: '¿Cuál es el número de pedido?', createdAt: at(2) },
        { orgId, conversationId: conv!.id, authorType: 'user', authorId: 'usr', body: 'Intern merknad', internal: true, createdAt: at(3) },
        { orgId, conversationId: conv!.id, authorType: 'system', authorId: 'system', body: 'Topic set.', createdAt: at(4) },
        { orgId, conversationId: conv!.id, authorType: 'end_user', authorId: endUserId, body: '   ', createdAt: at(5) },
      ])
      .returning();
    return { conv: conv!, messages };
  }

  async function eventTypes(): Promise<string[]> {
    const rows = await db.execute<{ type: string }>(
      sql`SELECT type FROM events WHERE org_id = ${orgId} ORDER BY created_at`,
    );
    return rows.map((r) => r.type);
  }

  it('lists only public customer, agent and teammate messages with a body as pending', async () => {
    const { conv, messages } = await seedConversation();
    const pending = await run(() => svc.pendingTranslations(conv.id, 'nb'));
    expect(pending.messages.map((m) => m.id)).toEqual([messages[0]!.id, messages[1]!.id]);
    expect(pending.customerLanguage).toBeNull();
    expect(pending.context).toEqual([]);
  });

  it('sends the already translated messages before a new one as context', async () => {
    const { conv, messages } = await seedConversation('es');
    await run(() =>
      svc.saveTranslations({
        conversationId: conv.id,
        targetLanguage: 'nb',
        translations: [
          { messageId: messages[0]!.id, body: 'Hei, hvor er bestillingen min?' },
          { messageId: messages[1]!.id, body: 'Hva er ordrenummeret?' },
        ],
      }),
    );
    const [followUp] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: conv.id,
        authorType: 'end_user',
        authorId: endUserId,
        body: 'El 40412',
        createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 6)),
      })
      .returning();
    const pending = await run(() => svc.pendingTranslations(conv.id, 'nb'));
    expect(pending.messages.map((m) => m.id)).toEqual([followUp!.id]);
    expect(pending.context).toEqual([
      { id: messages[0]!.id, authorType: 'end_user', body: 'Hola, ¿dónde está mi pedido?' },
      { id: messages[1]!.id, authorType: 'agent', body: '¿Cuál es el número de pedido?' },
    ]);
  });

  it('asks the agent to translate and announces it', async () => {
    const { conv } = await seedConversation();
    const res = await run(() => svc.requestTranslation(conv.id, 'NB'));
    expect(res).toEqual({ requested: true });
    const [event] = await db.execute<{ payload: Record<string, unknown> }>(
      sql`SELECT payload FROM events WHERE org_id = ${orgId} AND type = 'conversation.translation_requested'`,
    );
    expect(event!.payload).toMatchObject({ conversationId: conv.id, endUserId, targetLanguage: 'nb' });
  });

  it('does not ask when the customer already writes the target language', async () => {
    const { conv } = await seedConversation('no');
    const res = await run(() => svc.requestTranslation(conv.id, 'nb'));
    expect(res).toEqual({ requested: false });
    expect(await eventTypes()).not.toContain('conversation.translation_requested');
  });

  it('saves translations, records the customer language and stops asking', async () => {
    const { conv, messages } = await seedConversation();
    const res = await run(() =>
      svc.saveTranslations({
        conversationId: conv.id,
        targetLanguage: 'nb',
        customerLanguage: 'ES',
        translations: [
          { messageId: messages[0]!.id, body: 'Hei, hvor er bestillingen min?' },
          { messageId: messages[1]!.id, body: 'Hva er ordrenummeret?' },
          { messageId: messages[2]!.id, body: 'Internal must not be stored' },
          { messageId: 'cvm_not_in_this_conversation', body: 'Ignored' },
        ],
      }),
    );
    expect(res).toEqual({ saved: 2 });
    const stored = await run(() => svc.translationsFor(conv.id, 'nb'));
    expect(stored).toEqual({
      customerLanguage: 'es',
      targetLanguage: 'nb',
      messages: {
        [messages[0]!.id]: 'Hei, hvor er bestillingen min?',
        [messages[1]!.id]: 'Hva er ordrenummeret?',
      },
    });
    expect(await eventTypes()).toContain('conversation.translated');
    expect(await run(() => svc.requestTranslation(conv.id, 'nb'))).toEqual({ requested: false });
  });

  it('overwrites an earlier translation of the same message', async () => {
    const { conv, messages } = await seedConversation();
    const save = (body: string) =>
      run(() =>
        svc.saveTranslations({
          conversationId: conv.id,
          targetLanguage: 'nb',
          translations: [{ messageId: messages[0]!.id, body }],
        }),
      );
    await save('Første');
    await save('Andre');
    const stored = await run(() => svc.translationsFor(conv.id, 'nb'));
    expect(stored.messages[messages[0]!.id]).toBe('Andre');
  });

  it('drops a message translation when its body is rewritten', async () => {
    const { conv, messages } = await seedConversation();
    await run(() =>
      svc.saveTranslations({
        conversationId: conv.id,
        targetLanguage: 'nb',
        translations: [{ messageId: messages[0]!.id, body: 'Hei' }],
      }),
    );
    await run(() => deleteMessageTranslations(getCurrentContext().db, [messages[0]!.id]));
    const pending = await run(() => svc.pendingTranslations(conv.id, 'nb'));
    expect(pending.messages.map((m) => m.id)).toContain(messages[0]!.id);
  });

  it('hides translations from the customer and from other orgs', async () => {
    const { conv, messages } = await seedConversation();
    await run(() =>
      svc.saveTranslations({
        conversationId: conv.id,
        targetLanguage: 'nb',
        translations: [{ messageId: messages[0]!.id, body: 'Hei' }],
      }),
    );
    const count = () =>
      getCurrentContext()
        .db.select({ id: schema.convMessageTranslations.id })
        .from(schema.convMessageTranslations);
    expect(await run(count)).toHaveLength(1);
    expect(await run(count, actor, endUserId)).toHaveLength(0);
    const outsider = new ActorIdentity('admin_agent', 'agt_other', otherOrgId, ['*'], ['admin']);
    expect(await run(count, outsider)).toHaveLength(0);
  });

  async function seedDraft(conversationId: string, body: string, metadata: Record<string, unknown> = {}) {
    const [draft] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId,
        authorType: 'agent',
        authorId: 'agent',
        body,
        internal: true,
        metadata: { kind: 'draft_reply', ...metadata },
        createdAt: new Date(Date.UTC(2026, 8, 1, 12, 1, 0)),
      })
      .returning();
    return draft!;
  }

  describe('the pending draft', () => {
    it('is translated along with the thread when it is in the customer language', async () => {
      const { conv, messages } = await seedConversation('es');
      const draft = await seedDraft(conv.id, 'Su pedido salió el martes.');
      const pending = await run(() => svc.pendingTranslations(conv.id, 'nb'));
      expect(pending.messages.map((m) => m.id)).toEqual([messages[0]!.id, messages[1]!.id, draft.id]);

      await run(() =>
        svc.saveTranslations({
          conversationId: conv.id,
          targetLanguage: 'nb',
          translations: [{ messageId: draft.id, body: 'Bestillingen din ble sendt tirsdag.' }],
        }),
      );
      const stored = await run(() => svc.translationsFor(conv.id, 'nb'));
      expect(stored.messages[draft.id]).toBe('Bestillingen din ble sendt tirsdag.');
      const again = await run(() => svc.pendingTranslations(conv.id, 'nb'));
      expect(again.messages.map((m) => m.id)).not.toContain(draft.id);
    });

    it('is left alone when it was drafted in the target language', async () => {
      const { conv } = await seedConversation('es');
      const draft = await seedDraft(conv.id, 'Bestillingen din ble sendt tirsdag.', { language: 'nb' });
      const pending = await run(() => svc.pendingTranslations(conv.id, 'nb'));
      expect(pending.messages.map((m) => m.id)).not.toContain(draft.id);
    });

    it('sends the agent original when approved without changes, and translates an edit', async () => {
      const { conv } = await seedConversation('es');
      const draft = await seedDraft(conv.id, 'Su pedido salió el martes.');
      await run(() =>
        svc.saveTranslations({
          conversationId: conv.id,
          targetLanguage: 'nb',
          translations: [{ messageId: draft.id, body: 'Bestillingen din ble sendt tirsdag.' }],
        }),
      );
      const sent = await run(
        () =>
          svc.sendTranslatedReply({
            conversationId: conv.id,
            body: 'Bestillingen din ble sendt tirsdag.\n',
            sourceLanguage: 'nb',
            authorId: userId,
            fromDraftId: draft.id,
          }),
        teammate,
      );
      expect(sent.body).toBe('Su pedido salió el martes.');
      expect(translatorCalls).toHaveLength(0);
      expect(sent.metadata['approvedDraft']).toMatchObject({ edited: false });
      const stored = await run(() => svc.translationsFor(conv.id, 'nb'));
      expect(stored.messages[sent.id]).toBe('Bestillingen din ble sendt tirsdag.\n');

      const next = await seedDraft(conv.id, 'Le reembolsamos hoy.');
      await run(() =>
        svc.saveTranslations({
          conversationId: conv.id,
          targetLanguage: 'nb',
          translations: [{ messageId: next.id, body: 'Vi refunderer deg i dag.' }],
        }),
      );
      const edited = await run(
        () =>
          svc.sendTranslatedReply({
            conversationId: conv.id,
            body: 'Vi refunderer deg i morgen.',
            sourceLanguage: 'nb',
            authorId: userId,
            fromDraftId: next.id,
          }),
        teammate,
      );
      expect(edited.body).toBe('[es] Vi refunderer deg i morgen.');
      expect(edited.metadata['approvedDraft']).toMatchObject({ edited: true });
    });
  });

  describe('sendTranslatedReply', () => {
    it('sends the translation and keeps what the teammate wrote as its translation', async () => {
      const { conv } = await seedConversation('es');
      const sent = await run(
        () =>
          svc.sendTranslatedReply({
            conversationId: conv.id,
            body: 'Vi refunderer deg i dag.',
            sourceLanguage: 'nb',
            authorId: userId,
          }),
        teammate,
      );
      expect(sent.body).toBe('[es] Vi refunderer deg i dag.');
      expect(translatorCalls).toEqual([
        { orgId, text: 'Vi refunderer deg i dag.', sourceLanguage: 'nb', targetLanguage: 'es' },
      ]);
      const stored = await run(() => svc.translationsFor(conv.id, 'nb'));
      expect(stored.messages[sent.id]).toBe('Vi refunderer deg i dag.');
    });

    it('sends as typed when the customer writes the teammate language', async () => {
      const { conv } = await seedConversation('no');
      const sent = await run(
        () =>
          svc.sendTranslatedReply({
            conversationId: conv.id,
            body: 'Hei!',
            sourceLanguage: 'nb',
            authorId: userId,
          }),
        teammate,
      );
      expect(sent.body).toBe('Hei!');
      expect(translatorCalls).toHaveLength(0);
    });

    it('sends nothing when the translation fails', async () => {
      const { conv } = await seedConversation('es');
      translatorReply = () => Promise.reject(new Error('provider down'));
      await expect(
        run(
          () =>
            svc.sendTranslatedReply({
              conversationId: conv.id,
              body: 'Hei',
              sourceLanguage: 'nb',
              authorId: userId,
            }),
          teammate,
        ),
      ).rejects.toThrow(BadGatewayException);
      const [row] = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM conv_messages WHERE conversation_id = ${conv.id} AND author_type = 'user' AND internal = false`,
      );
      expect(row!.n).toBe(0);
    });

    it('refuses while the customer language is still unknown', async () => {
      const { conv } = await seedConversation(null);
      await expect(
        run(
          () =>
            svc.sendTranslatedReply({
              conversationId: conv.id,
              body: 'Hei',
              sourceLanguage: 'nb',
              authorId: userId,
            }),
          teammate,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks draft slots and edits against what the teammate wrote, not the translation', async () => {
      const { conv } = await seedConversation('es');
      const [draft] = await db
        .insert(schema.convMessages)
        .values({
          orgId,
          conversationId: conv.id,
          authorType: 'agent',
          authorId: 'agent',
          body: 'Pakken kommer [DATO].',
          internal: true,
          metadata: { kind: 'draft_reply', slots: ['[DATO]'] },
        })
        .returning();
      await expect(
        run(
          () =>
            svc.sendTranslatedReply({
              conversationId: conv.id,
              body: 'Pakken kommer [DATO].',
              sourceLanguage: 'nb',
              authorId: userId,
              fromDraftId: draft!.id,
            }),
          teammate,
        ),
      ).rejects.toThrow(/conv_draft_slots_open/);
      const sent = await run(
        () =>
          svc.sendTranslatedReply({
            conversationId: conv.id,
            body: 'Pakken kommer fredag.',
            sourceLanguage: 'nb',
            authorId: userId,
            fromDraftId: draft!.id,
          }),
        teammate,
      );
      expect(sent.metadata['approvedDraft']).toMatchObject({ edited: true });
    });
  });
});

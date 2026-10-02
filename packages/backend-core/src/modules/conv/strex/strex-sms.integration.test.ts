import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { ConflictException, type INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq, and } from 'drizzle-orm';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { ChannelAdminService } from '../channels/channel-admin.service.ts';
import { OutboundDeliveryWorker } from '../channels/outbound-delivery.worker.ts';
import { StrexClientService, strexSigningMessage } from './strex-client.service.ts';
import { StrexSmsService } from './strex-sms.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run Strex SMS integration tests.';

(skipReason ? describe.skip : describe)('Strex SMS channel integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let client: StrexClientService;
  let listKeywordsSpy: MockInstance<StrexClientService['listKeywords']>;
  let createKeywordSpy: MockInstance<StrexClientService['createKeyword']>;
  let deleteKeywordSpy: MockInstance<StrexClientService['deleteKeyword']>;
  let sendSmsSpy: MockInstance<StrexClientService['sendSms']>;
  let orgId: string;
  let channelId: string;
  const API_KEY = 'strex-api-key-it';
  const SHORT_NUMBER_ID = 'NO-2002';
  const SERVER_KEY_NAME = 'strex-server-key-it';
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let actor: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-strex-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_API_URL = 'https://munin.example';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Strex IT Org' }).returning();
    orgId = org!.id;
    actor = new ActorIdentity('user', 'usr_test', orgId, ['*'], ['admin']);

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;

    client = app.get(StrexClientService);
    listKeywordsSpy = vi.spyOn(client, 'listKeywords').mockResolvedValue([]);
    createKeywordSpy = vi.spyOn(client, 'createKeyword').mockResolvedValue('kw_catch_all');
    deleteKeywordSpy = vi.spyOn(client, 'deleteKeyword').mockResolvedValue();
    sendSmsSpy = vi
      .spyOn(client, 'sendSms')
      .mockImplementation((_creds, message) => Promise.resolve({ transactionId: message.transactionId }));
    vi.spyOn(client, 'serverPublicKey').mockResolvedValue(publicKey);

    const pending = await runAsActor(() =>
      app.get(ChannelAdminService).configure(
        {
          vendor: 'strex',
          name: 'Strex main',
          config: { sender: '2002', shortNumberId: SHORT_NUMBER_ID },
        },
        { rejectSecrets: true },
      ),
    );
    channelId = pending.id;
    const completed = await runAsActor(() =>
      app.get(ChannelAdminService).completeSetup(channelId, { apiKey: API_KEY }),
    );
    expect(completed.ok).toBe(true);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  beforeEach(() => {
    listKeywordsSpy.mockClear();
    createKeywordSpy.mockClear();
    deleteKeywordSpy.mockClear();
    sendSmsSpy.mockClear();
  });

  async function runAsActor<T>(fn: () => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx.execute(
        sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`,
      );
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  function signatureFor(forChannelId: string, rawBody: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const message = strexSigningMessage({
      method: 'post',
      uri: `https://munin.example/v1/conversations/channels/${forChannelId}/webhook`,
      timestamp,
      nonce,
      rawBody: Buffer.from(rawBody),
    });
    const signature = sign('sha256', Buffer.from(message), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64');
    return `${SERVER_KEY_NAME}:${timestamp}:${nonce}:${signature}`;
  }

  async function postForward(
    payload: Record<string, unknown>,
    opts: { signature?: string | null; signedFor?: string } = {},
  ): Promise<Response> {
    const body = JSON.stringify(payload);
    const signature =
      opts.signature === undefined ? signatureFor(opts.signedFor ?? channelId, body) : opts.signature;
    return fetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'x-ecdsa-signature': signature } : {}),
      },
      body,
    });
  }

  async function messagesWithProviderId(providerMessageId: string) {
    return db
      .select({
        id: schema.convMessages.id,
        body: schema.convMessages.body,
        conversationId: schema.convMessages.conversationId,
      })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.orgId, orgId),
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${providerMessageId}`,
        ),
      );
  }

  async function loadChannelConfig(id: string): Promise<Record<string, unknown>> {
    const [row] = await db
      .select({ config: schema.convChannels.config, active: schema.convChannels.active })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, id));
    return { ...row!.config, active: row!.active };
  }

  it('completing the credential link registers a catch-all keyword forwarding to the channel', async () => {
    const config = await loadChannelConfig(channelId);
    expect(config.active).toBe(true);
    expect(config.pendingSetup).toBeUndefined();
    expect(config.keywordId).toBe('kw_catch_all');
    expect(await client.loadSecret(config.encryptedApiKey as string)).toBe(API_KEY);
    expect(
      await runAsActor(() =>
        app.get(StrexSmsService).completeSetup(channelId, { apiKey: API_KEY }),
      ),
    ).toMatchObject({ ok: true });
    expect(createKeywordSpy).toHaveBeenCalledWith(
      { apiKey: API_KEY, environment: 'production' },
      {
        shortNumberId: SHORT_NUMBER_ID,
        keywordText: '*',
        mode: 'Wildcard',
        forwardUrl: `https://munin.example/v1/conversations/channels/${channelId}/webhook`,
      },
    );
  });

  it('reuses a keyword that already forwards to this channel instead of creating a second one', async () => {
    listKeywordsSpy.mockResolvedValueOnce([
      {
        keywordId: 'kw_existing',
        shortNumberId: SHORT_NUMBER_ID,
        keywordText: '*',
        mode: 'Wildcard',
        forwardUrl: `https://munin.example/v1/conversations/channels/${channelId}/webhook`,
        enabled: true,
      },
    ]);
    await runAsActor(() => app.get(StrexSmsService).completeSetup(channelId, { apiKey: API_KEY }));
    expect(createKeywordSpy).not.toHaveBeenCalled();
    expect((await loadChannelConfig(channelId)).keywordId).toBe('kw_existing');
  });

  it('refuses a keyword that another integration already owns on the short number', async () => {
    listKeywordsSpy.mockResolvedValueOnce([
      {
        keywordId: 'kw_someone_else',
        shortNumberId: SHORT_NUMBER_ID,
        keywordText: 'ACME',
        mode: 'Exact',
        forwardUrl: 'https://elsewhere.example/sms',
        enabled: true,
      },
    ]);
    await expect(
      runAsActor(() =>
        app.get(StrexSmsService).updateChannel({ channelId, config: { keyword: 'ACME' } }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createKeywordSpy).not.toHaveBeenCalled();
    expect(deleteKeywordSpy).not.toHaveBeenCalled();
  });

  it('ingests a signed inbound text and answers 200 so Strex stops retrying', async () => {
    const res = await postForward({
      transactionId: 'strex_in_0001',
      created: new Date().toISOString(),
      sender: '+4712345671',
      recipient: '2002',
      content: 'Hei, hvor er pakken min?',
    });
    expect(res.status).toBe(200);
    const rows = await messagesWithProviderId('strex_in_0001');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('Hei, hvor er pakken min?');
  });

  it('dedupes a forward Strex retries', async () => {
    const payload = {
      transactionId: 'strex_in_dedup',
      created: new Date().toISOString(),
      sender: '+4712345672',
      recipient: '2002',
      content: 'first delivery',
    };
    expect((await postForward(payload)).status).toBe(200);
    expect((await postForward(payload)).status).toBe(200);
    expect(await messagesWithProviderId('strex_in_dedup')).toHaveLength(1);
  });

  it('rejects a forward with no signature, a forged one, or one signed for another channel', async () => {
    const payload = {
      transactionId: 'strex_in_unsigned',
      sender: '+4712345673',
      recipient: '2002',
      content: 'unsigned',
    };
    expect((await postForward(payload, { signature: null })).status).toBe(401);
    expect(
      (await postForward(payload, { signature: `${SERVER_KEY_NAME}:1:nonce:${'A'.repeat(88)}` }))
        .status,
    ).toBe(401);
    expect((await postForward(payload, { signedFor: 'cch_someone_else' })).status).toBe(401);
    expect(await messagesWithProviderId('strex_in_unsigned')).toHaveLength(0);
  });

  it('suppresses the CRM contact when Strex flags the text as a stop message', async () => {
    const from = '+4712345674';
    const [crmContact] = await db
      .insert(schema.crmContacts)
      .values({
        orgId,
        name: 'Kari Nordmann',
        phone: from,
        consentLawfulBasis: 'consent',
        consentGivenAt: new Date(),
        consentSource: 'imported-test',
      })
      .returning();
    await postForward({
      transactionId: 'strex_in_stop',
      sender: from,
      recipient: '2002',
      content: 'STOPP ACME',
      isStopMessage: true,
    });
    const [after] = await db
      .select({ doNotContact: schema.crmContacts.doNotContact })
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, crmContact!.id));
    expect(after!.doNotContact).toBe(true);
  });

  it('sends a queued reply with the delivery id as transaction id and applies its delivery report', async () => {
    const [inbound] = await messagesWithProviderId('strex_in_0001');
    const [reply] = await db
      .insert(schema.convMessages)
      .values({
        orgId,
        conversationId: inbound!.conversationId,
        authorType: 'agent',
        authorId: 'agent_test',
        body: 'Pakken er på vei.',
      })
      .returning();
    const [delivery] = await db
      .insert(schema.convMessageDeliveries)
      .values({
        orgId,
        messageId: reply!.id,
        channelId,
        status: 'queued',
        attempt: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
      })
      .returning();

    await app.get(OutboundDeliveryWorker).tick();

    expect(sendSmsSpy).toHaveBeenCalledWith(
      { apiKey: API_KEY, environment: 'production' },
      {
        transactionId: delivery!.id,
        sender: '2002',
        recipient: '+4712345671',
        content: 'Pakken er på vei.',
        deliveryReportUrl: `https://munin.example/v1/conversations/channels/${channelId}/webhook`,
      },
    );
    const loadDelivery = async () =>
      (
        await db
          .select()
          .from(schema.convMessageDeliveries)
          .where(eq(schema.convMessageDeliveries.id, delivery!.id))
      )[0]!;
    expect((await loadDelivery()).status).toBe('sent');
    expect((await loadDelivery()).messageIdHeader).toBe(delivery!.id);

    const duplicate = await postForward({
      transactionId: delivery!.id,
      statusCode: 'Failed',
      detailedStatusCode: 'DuplicateTransaction',
      delivered: false,
    });
    expect(duplicate.status).toBe(200);
    expect((await loadDelivery()).status).toBe('sent');

    const failed = await postForward({
      transactionId: delivery!.id,
      statusCode: 'Failed',
      detailedStatusCode: 'SubscriberBarred',
      delivered: false,
    });
    expect(failed.status).toBe(200);
    expect((await loadDelivery()).status).toBe('failed');
    expect((await loadDelivery()).error).toBe('strex_SubscriberBarred');
  });

  it('switching to a keyword registers the new route before deleting the old one', async () => {
    createKeywordSpy.mockResolvedValueOnce('kw_acme');
    const dto = await runAsActor(() =>
      app.get(StrexSmsService).updateChannel({ channelId, config: { keyword: 'ACME' } }),
    );
    expect(dto.config).toMatchObject({ keyword: 'ACME', inboundKeywordId: 'kw_acme' });
    expect(createKeywordSpy).toHaveBeenCalledWith(
      { apiKey: API_KEY, environment: 'production' },
      expect.objectContaining({ keywordText: 'ACME', mode: 'Exact' }),
    );
    expect(deleteKeywordSpy).toHaveBeenCalledWith(
      { apiKey: API_KEY, environment: 'production' },
      'kw_existing',
    );
    expect(createKeywordSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteKeywordSpy.mock.invocationCallOrder[0]!,
    );
  });

  it('clearing the short number makes the channel outbound-only and removes the keyword', async () => {
    const dto = await runAsActor(() =>
      app.get(StrexSmsService).updateChannel({ channelId, config: { shortNumberId: null } }),
    );
    expect(dto.config).toMatchObject({ shortNumberId: null, inboundKeywordId: null });
    expect(createKeywordSpy).not.toHaveBeenCalled();
    expect(deleteKeywordSpy).toHaveBeenCalledWith(expect.anything(), 'kw_acme');
  });

  it('archiving a channel deletes its inbound keyword at Strex', async () => {
    const created = await runAsActor(() =>
      app.get(StrexSmsService).createChannel({
        name: 'Strex archive',
        config: { apiKey: API_KEY, sender: '2003', shortNumberId: 'NO-2003' },
      }),
    );
    expect(created.config.inboundKeywordId).toBe('kw_catch_all');
    deleteKeywordSpy.mockClear();
    await runAsActor(() => app.get(ChannelAdminService).onArchive(created.id));
    expect(deleteKeywordSpy).toHaveBeenCalledWith(
      { apiKey: API_KEY, environment: 'production' },
      'kw_catch_all',
    );
  });

  it('rejects the api key through the configure tool boundary', async () => {
    await expect(
      runAsActor(() =>
        app.get(ChannelAdminService).configure(
          { vendor: 'strex', name: 'leaky', config: { sender: '2002', apiKey: 'nope' } },
          { rejectSecrets: true },
        ),
      ),
    ).rejects.toThrow(/secret fields \(apiKey\)/);
  });
});

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { TRANSCRIBE_VOICE_NOTE_TASK_URI } from '@getmunin/types';
import { AppModule } from '../../../app.module.ts';
import { createApp } from '../../../bootstrap-app.ts';
import { ChannelAdminService } from '../channels/channel-admin.service.ts';
import { ChannelCredentialService } from '../channels/channel-credential.service.ts';
import { OutboundDeliveryWorker } from '../channels/outbound-delivery.worker.ts';
import { ConvService } from '../conv.service.ts';
import { deriveVerifyToken } from './meta-graph-client.service.ts';
import { MetaWhatsAppService } from './meta-whatsapp.service.ts';
import { WhatsAppTemplatesService } from './whatsapp-templates.service.ts';
import { WhatsAppWindowClosedException } from './whatsapp-window.ts';
import { OutreachService } from '../../outreach/outreach.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL ? null : 'Set TEST_DATABASE_URL to run WhatsApp integration tests.';

const APP_SECRET = 'whatsapp-app-secret-for-it';
const ACCESS_TOKEN = 'EAAG-test-access-token';
const WABA_ID = '100000000000001';
const PHONE_NUMBER_ID = '200000000000002';
const GRAPH = 'https://graph.facebook.com';

interface GraphCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

(skipReason ? describe.skip : describe)('WhatsApp (Meta Cloud API) channel integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let channelId: string;
  let graphCalls: GraphCall[] = [];
  let templates: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_ENCRYPTION_KEY ??=
      'dGVzdC1lbmNyeXB0aW9uLWtleS1tdXN0LWJlLWxvbmctZW5vdWdoLWZvci1wZ2NyeXB0bw==';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-whatsapp-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [org] = await db.insert(schema.orgs).values({ name: 'WhatsApp IT Org' }).returning();
    const [other] = await db.insert(schema.orgs).values({ name: 'WhatsApp IT Other Org' }).returning();
    orgId = org!.id;
    otherOrgId = other!.id;

    app = await createApp(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.MUNIN_API_URL = baseUrl;

    vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch);

    const admin = app.get(ChannelAdminService);
    const credentials = app.get(ChannelCredentialService);
    const pending = await asAdmin(() =>
      admin.configure(
        { vendor: 'meta', name: 'Support WhatsApp', config: { wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID } },
        { rejectSecrets: true },
      ),
    );
    expect(pending.active).toBe(false);
    channelId = pending.id;
    const applied = await asAdmin(() =>
      credentials.apply(channelId, { accessToken: ACCESS_TOKEN, appSecret: APP_SECRET }),
    );
    expect(applied).toMatchObject({ ok: true });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id IN (${orgId}, ${otherOrgId})`);
    }
  });

  beforeEach(() => {
    graphCalls = [];
  });

  async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://lookaside.example/')) {
      return new Response(Buffer.from('OggS-fake-voice-note-bytes'), {
        status: 200,
        headers: { 'content-type': 'audio/ogg' },
      });
    }
    if (!url.startsWith(GRAPH)) return realFetch(input, init);
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/v\d+\.\d+/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    graphCalls.push({ method, path, body });

    if (method === 'GET' && path === `/${PHONE_NUMBER_ID}`) {
      return json({ id: PHONE_NUMBER_ID, display_phone_number: '+47 12 34 56 78', verified_name: 'Acme', quality_rating: 'GREEN' });
    }
    if (method === 'POST' && path === `/${WABA_ID}/subscribed_apps`) return json({ success: true });
    if (method === 'POST' && path === `/${PHONE_NUMBER_ID}`) {
      const config = (body?.webhook_configuration ?? {}) as Record<string, string>;
      const verify = await realFetch(
        `${config.override_callback_uri}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.verify_token ?? '')}&hub.challenge=4242`,
      );
      const echoed = await verify.text();
      if (verify.status !== 200 || echoed !== '4242') {
        return json({ error: { code: 2200, message: 'Callback verification failed' } }, 400);
      }
      return json({ success: true });
    }
    if (method === 'POST' && path === `/${PHONE_NUMBER_ID}/messages`) {
      return json({
        messaging_product: 'whatsapp',
        contacts: [{ input: body?.to, wa_id: body?.to }],
        messages: [{ id: `wamid.out.${randomUUID()}` }],
      });
    }
    if (method === 'GET' && path === `/${WABA_ID}/message_templates`) return json({ data: templates });
    if (method === 'GET' && path.startsWith('/media_')) {
      return json({ url: 'https://lookaside.example/voice.ogg', mime_type: 'audio/ogg; codecs=opus' });
    }
    return json({ error: { code: 100, message: `unexpected ${method} ${path}` } }, 400);
  }

  function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }

  async function runAs<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx.execute(sql`SELECT set_config('app.crypt_key', ${process.env.MUNIN_ENCRYPTION_KEY ?? ''}, true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    return runAs(new ActorIdentity('user', 'usr_whatsapp_it', orgId, ['*'], ['admin']), fn);
  }

  function sign(body: string): string {
    return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  }

  async function postWebhook(value: Record<string, unknown>, signature?: string): Promise<Response> {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '4712345678', phone_number_id: PHONE_NUMBER_ID },
                ...value,
              },
            },
          ],
        },
      ],
    });
    return realFetch(`${baseUrl}/v1/conversations/channels/${channelId}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(body) },
      body,
    });
  }

  function inbound(from: string, id: string, extra: Record<string, unknown>) {
    return {
      contacts: [{ profile: { name: 'Kari Nordmann' }, wa_id: from.replace('+', '') }],
      messages: [{ from: from.replace('+', ''), id, timestamp: String(Math.floor(Date.now() / 1000)), ...extra }],
    };
  }

  async function messageByProviderId(providerMessageId: string) {
    const rows = await db
      .select()
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.orgId, orgId),
          sql`${schema.convMessages.metadata}->>'providerMessageId' = ${providerMessageId}`,
        ),
      );
    return rows[0] ?? null;
  }

  it('activates the channel through the credential link and registers the phone-number webhook', async () => {
    const [channel] = await db.select().from(schema.convChannels).where(eq(schema.convChannels.id, channelId));
    expect(channel).toMatchObject({ type: 'whatsapp', vendor: 'meta', active: true });
    expect(channel!.config).toMatchObject({ wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID, displayPhoneNumber: '+47 12 34 56 78' });
    expect(JSON.stringify(channel!.config)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(channel!.config)).not.toContain(APP_SECRET);
  });

  it('registers a channel created with secrets in one call, before the row is committed', async () => {
    const svc = app.get(MetaWhatsAppService);
    const created = await asAdmin(() =>
      svc.createChannel({
        name: 'Direct',
        config: { wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID, accessToken: ACCESS_TOKEN, appSecret: APP_SECRET },
      }),
    );
    expect(created.active).toBe(true);
    expect(created.config.webhookUrl).toBe(`${baseUrl}/v1/conversations/channels/${created.id}/webhook`);
    expect(graphCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /${PHONE_NUMBER_ID}`,
      `POST /${WABA_ID}/subscribed_apps`,
      `POST /${PHONE_NUMBER_ID}`,
    ]);
    await db.update(schema.convChannels).set({ archivedAt: new Date(), active: false }).where(eq(schema.convChannels.id, created.id));
  });

  it('answers the verification challenge only with the channel’s token', async () => {
    const token = deriveVerifyToken(channelId);
    const ok = await realFetch(
      `${baseUrl}/v1/conversations/channels/${channelId}/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=99`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('99');
    const bad = await realFetch(
      `${baseUrl}/v1/conversations/channels/${channelId}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=99`,
    );
    expect(bad.status).toBe(403);
  });

  it('ingests a signed text message and threads it on the sender’s phone', async () => {
    const res = await postWebhook(inbound('+4712345678', 'wamid.in.text1', { type: 'text', text: { body: 'Hei, hvor er pakken?' } }));
    expect(res.status).toBe(200);
    const message = await messageByProviderId('wamid.in.text1');
    expect(message).toMatchObject({ body: 'Hei, hvor er pakken?', authorType: 'end_user' });
    expect(message!.metadata).toMatchObject({ whatsappType: 'text' });

    await postWebhook(inbound('+4712345678', 'wamid.in.text2', { type: 'text', text: { body: 'Ordrenummer A-1' } }));
    const second = await messageByProviderId('wamid.in.text2');
    expect(second!.conversationId).toBe(message!.conversationId);

    const [contact] = await db
      .select({ phone: schema.convContacts.phone, name: schema.convContacts.name })
      .from(schema.convConversations)
      .innerJoin(schema.convContacts, eq(schema.convContacts.id, schema.convConversations.contactId))
      .where(eq(schema.convConversations.id, message!.conversationId));
    expect(contact).toEqual({ phone: '+4712345678', name: 'Kari Nordmann' });
  });

  it('rejects an unsigned or mis-signed delivery', async () => {
    const res = await postWebhook(inbound('+4701234567', 'wamid.in.forged', { type: 'text', text: { body: 'x' } }), 'sha256=00');
    expect(res.status).toBe(401);
    expect(await messageByProviderId('wamid.in.forged')).toBeNull();
  });

  it('stores a voice note, marks it pending, and queues transcription', async () => {
    await postWebhook(
      inbound('+4702345678', 'wamid.in.voice', { type: 'audio', audio: { id: 'media_voice_1', mime_type: 'audio/ogg; codecs=opus', voice: true } }),
    );
    const message = await messageByProviderId('wamid.in.voice');
    expect(message!.metadata).toMatchObject({ voiceNote: true, transcription: { status: 'pending' } });
    const attachments = await db.select().from(schema.convAttachments).where(eq(schema.convAttachments.messageId, message!.id));
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.mime).toBe('audio/ogg');

    const jobs = await db
      .select()
      .from(schema.curatorJobs)
      .where(and(eq(schema.curatorJobs.orgId, orgId), eq(schema.curatorJobs.jobUri, TRANSCRIBE_VOICE_NOTE_TASK_URI)));
    expect(jobs.map((j) => (j.sourceEventPayload as { messageId: string }).messageId)).toContain(message!.id);

    const conv = app.get(ConvService);
    const result = await asAdmin(() =>
      conv.recordVoiceNoteTranscription({
        conversationId: message!.conversationId,
        messageId: message!.id,
        status: 'done',
        text: 'Jeg vil endre leveringsadressen',
        model: 'whisper-large-v3',
      }),
    );
    expect(result.status).toBe('done');
    const after = await messageByProviderId('wamid.in.voice');
    expect(after!.body).toBe('Jeg vil endre leveringsadressen');
    expect(after!.metadata).toMatchObject({ transcription: { status: 'done', model: 'whisper-large-v3' } });

    await expect(
      asAdmin(() =>
        conv.recordVoiceNoteTranscription({
          conversationId: message!.conversationId,
          messageId: message!.id,
          status: 'done',
          text: 'again',
        }),
      ),
    ).rejects.toThrow(/conv_conflict/);
  });

  it('sends an in-window reply as text and records read receipts like email opens', async () => {
    const inboundMessage = await messageByProviderId('wamid.in.text1');
    const conv = app.get(ConvService);
    const sent = await asAdmin(() =>
      conv.sendMessage({
        conversationId: inboundMessage!.conversationId,
        body: 'Pakken er på vei!',
        authorType: 'user',
        authorId: 'usr_whatsapp_it',
        claim: false,
      }),
    );
    const drain = await app.get(OutboundDeliveryWorker).tick();
    expect(drain.sent).toBeGreaterThanOrEqual(1);
    const send = graphCalls.find((c) => c.path === `/${PHONE_NUMBER_ID}/messages`);
    expect(send!.body).toMatchObject({ to: '4712345678', type: 'text', text: { body: 'Pakken er på vei!' } });

    const [delivery] = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageId, sent.id));
    expect(delivery!.status).toBe('sent');
    expect(delivery!.messageIdHeader).toMatch(/^wamid\.out\./);

    await postWebhook({ statuses: [{ id: delivery!.messageIdHeader, status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] });
    const [read] = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.id, delivery!.id));
    expect(read!.firstOpenedAt).not.toBeNull();
    expect(read!.openCount).toBe(1);
  });

  it('marks a delivery dead when Meta reports the window closed', async () => {
    const inboundMessage = await messageByProviderId('wamid.in.text2');
    const [msg] = await db
      .insert(schema.convMessages)
      .values({ orgId, conversationId: inboundMessage!.conversationId, authorType: 'agent', authorId: 'agent_it', body: 'late' })
      .returning();
    await db.insert(schema.convMessageDeliveries).values({
      orgId,
      messageId: msg!.id,
      channelId,
      status: 'sent',
      attempt: 1,
      sentAt: new Date(),
      messageIdHeader: 'wamid.out.late',
      nextAttemptAt: null,
    });
    await postWebhook({
      statuses: [
        {
          id: 'wamid.out.late',
          status: 'failed',
          timestamp: String(Math.floor(Date.now() / 1000)),
          errors: [{ code: 131047, title: 'Re-engagement message' }],
        },
      ],
    });
    const [dead] = await db
      .select()
      .from(schema.convMessageDeliveries)
      .where(eq(schema.convMessageDeliveries.messageIdHeader, 'wamid.out.late'));
    expect(dead!.status).toBe('dead');
    expect(dead!.error).toMatch(/^whatsapp_window_closed/);
  });

  it('refuses a free-form message once the 24-hour window has closed', async () => {
    const inboundMessage = await messageByProviderId('wamid.in.text1');
    await db
      .update(schema.convMessages)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(and(eq(schema.convMessages.conversationId, inboundMessage!.conversationId), eq(schema.convMessages.authorType, 'end_user')));

    const conv = app.get(ConvService);
    const detail = await asAdmin(() => conv.getConversation(inboundMessage!.conversationId));
    expect(detail.whatsappWindow).toMatchObject({ open: false });
    await expect(
      asAdmin(() =>
        conv.sendMessage({
          conversationId: inboundMessage!.conversationId,
          body: 'Hallo?',
          authorType: 'agent',
          authorId: 'agent_it',
        }),
      ),
    ).rejects.toBeInstanceOf(WhatsAppWindowClosedException);
  });

  it('sends an approved template outside the window and starts a conversation for a consenting contact', async () => {
    templates = [
      {
        id: 'tpl_1',
        name: 'order_update',
        language: 'nb',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'POSITIONAL',
        components: [{ type: 'BODY', text: 'Hei {{1}}, ordren din er {{2}}.' }],
      },
      {
        id: 'tpl_2',
        name: 'spring_sale',
        language: 'nb',
        status: 'PENDING',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Salg!' }],
      },
    ];
    const [crm] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Ola Nordmann', phone: '+4703456789', consentLawfulBasis: 'consent', consentGivenAt: new Date(), consentSource: 'checkout-opt-in' })
      .returning();
    const svc = app.get(WhatsAppTemplatesService);

    await expect(
      asAdmin(() => svc.sendTemplate({ channelId, contactId: crm!.id, templateName: 'spring_sale', language: 'nb' })),
    ).rejects.toThrow(/only approved templates/);
    await expect(
      asAdmin(() =>
        svc.sendTemplate({ channelId, contactId: crm!.id, templateName: 'order_update', language: 'nb', variables: { '1': 'Ola' } }),
      ),
    ).rejects.toThrow(/missing \{\{2\}\}/);

    const result = await asAdmin(() =>
      svc.sendTemplate({
        channelId,
        contactId: crm!.id,
        templateName: 'order_update',
        language: 'nb',
        variables: { '1': 'Ola', '2': 'sendt' },
      }),
    );
    expect(result.createdConversation).toBe(true);
    expect(result.message.body).toBe('Hei Ola, ordren din er sendt.');

    await app.get(OutboundDeliveryWorker).tick();
    const send = graphCalls.filter((c) => c.path === `/${PHONE_NUMBER_ID}/messages`).at(-1);
    expect(send!.body).toMatchObject({
      to: '4703456789',
      type: 'template',
      template: {
        name: 'order_update',
        language: { code: 'nb' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ola' }, { type: 'text', text: 'sendt' }] }],
      },
    });
  });

  it('refuses a template to a contact without recorded consent', async () => {
    const [crm] = await db.insert(schema.crmContacts).values({ orgId, name: 'Kari Nordmann', phone: '+4704567890' }).returning();
    await expect(
      asAdmin(() =>
        app.get(WhatsAppTemplatesService).sendTemplate({
          channelId,
          contactId: crm!.id,
          templateName: 'order_update',
          language: 'nb',
          variables: { '1': 'Kari', '2': 'sendt' },
        }),
      ),
    ).rejects.toThrow(/lawful basis/);
  });

  it('treats a "Stop promotions" button as an opt-out', async () => {
    const [crm] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Ola Nordmann', phone: '+4705678901', consentLawfulBasis: 'consent', consentGivenAt: new Date(), consentSource: 'it' })
      .returning();
    await postWebhook(inbound('+4705678901', 'wamid.in.stop', { type: 'button', button: { text: 'Stop promotions', payload: 'Stop promotions' } }));
    const [after] = await db
      .select({ doNotContact: schema.crmContacts.doNotContact })
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, crm!.id));
    expect(after!.doNotContact).toBe(true);
  });

  it('runs a WhatsApp outreach first touch as a template the operator approves', async () => {
    const outreach = app.get(OutreachService);
    const [segment] = await db
      .insert(schema.crmSegments)
      .values({ orgId, name: 'WhatsApp opt-ins', createdByActorType: 'user', createdByActorId: 'usr_whatsapp_it' })
      .returning();
    const [crm] = await db
      .insert(schema.crmContacts)
      .values({ orgId, name: 'Kari Nordmann', phone: '+4706789012', consentLawfulBasis: 'consent', consentGivenAt: new Date(), consentSource: 'it' })
      .returning();
    const campaign = await asAdmin(() =>
      outreach.createCampaign({
        name: 'Reorder nudge',
        brief: 'Remind past buyers',
        segmentId: segment!.id,
        channelId,
        enabled: true,
      }),
    );

    await expect(
      asAdmin(() => outreach.proposeInitial({ campaignId: campaign.id, contactId: crm!.id, draftBody: 'free text' })),
    ).rejects.toThrow(/must be an approved template/);

    const proposal = await asAdmin(() =>
      outreach.proposeInitial({
        campaignId: campaign.id,
        contactId: crm!.id,
        whatsappTemplate: { templateName: 'order_update', language: 'nb', variables: { '1': 'Kari', '2': 'klar' } },
      }),
    );
    expect(proposal.draftBody).toBe('Hei Kari, ordren din er klar.');
    expect(proposal.whatsappTemplate).toMatchObject({ name: 'order_update', language: 'nb' });

    await expect(
      asAdmin(() => outreach.updateProposal({ id: proposal.id, draftBody: 'edited' })),
    ).rejects.toThrow(/text is fixed by Meta/);

    const approved = await asAdmin(() =>
      outreach.approveProposal(proposal.id, { publicBaseUrl: baseUrl, fingerprint: proposal.draftFingerprint }),
    );
    expect(approved.status).toBe('sent');
    const [conversation] = await db
      .select({ outreachCampaignId: schema.convConversations.outreachCampaignId, agentMode: schema.convConversations.agentMode })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, approved.conversationId!));
    expect(conversation).toEqual({ outreachCampaignId: campaign.id, agentMode: 'draft_only' });
  });

  it('keeps one org’s WhatsApp channel out of another org’s reach', async () => {
    const svc = app.get(MetaWhatsAppService);
    await expect(
      runAs(new ActorIdentity('user', 'usr_other', otherOrgId, ['*'], ['admin']), () => svc.loadChannel(channelId)),
    ).rejects.toThrow(/not found/);
    const latest = await db
      .select({ id: schema.convMessages.id })
      .from(schema.convMessages)
      .where(eq(schema.convMessages.orgId, otherOrgId))
      .orderBy(desc(schema.convMessages.createdAt))
      .limit(1);
    expect(latest).toHaveLength(0);
  });
});

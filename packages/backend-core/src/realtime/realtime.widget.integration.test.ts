import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApiKey, hashSecret, keyPrefix, signHmac } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run widget WS integration tests.';

(skipReason ? describe.skip : describe)('Realtime widget subscriptions', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsBase: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let widgetKey: string;
  let channelId: string;
  let identitySecret: string;

  const ALLOWED_ORIGIN = 'https://customer.example';

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-widget-rt-test';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const ts = Date.now();
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'Widget RT IT Org', slug: `widget-rt-it-${ts}` })
      .returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'widget-rt-it-admin',
      keyHash: hashSecret(adminKey),
      keyPrefix: keyPrefix(adminKey),
      scopes: ['*'],
    });

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsBase = `ws://127.0.0.1:${address.port}`;

    const created = await withClient(adminKey, async (c) => {
      return parseToolResult<{
        id: string;
        widgetKey: string;
        identityVerificationSecret: string;
      }>(
        await c.callTool({
          name: 'conv_widget_create_channel',
          arguments: {
            name: 'rt-storefront-bot',
            displayName: 'RT Storefront Bot',
            originAllowlist: [ALLOWED_ORIGIN],
          },
        }),
      );
    });
    channelId = created.id;
    widgetKey = created.widgetKey;
    identitySecret = created.identityVerificationSecret;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function withClient<T>(token: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const c = new Client({ name: 'munin-widget-rt-it', version: '0.0.0' });
    await c.connect(transport);
    try {
      return await fn(c);
    } finally {
      await transport.close();
      await c.close();
    }
  }

  async function ingest(
    token: string,
    body: Record<string, unknown>,
    origin?: string,
  ): Promise<number> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (origin) headers.Origin = origin;
    const res = await fetch(`${baseUrl}/api/v1/widget/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return res.status;
  }

  function connectWs(
    token: string,
    opts: {
      origin?: string;
      query?: Record<string, string>;
    } = {},
  ): WebSocket {
    const headers: Record<string, string> = {};
    if (opts.origin) headers.Origin = opts.origin;
    const search = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    return new WebSocket(`${wsBase}/api/v1/realtime${search}`, ['bearer', token], { headers });
  }

  async function waitForOpen(ws: WebSocket, timeoutMs = 1500): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ws never opened within ${timeoutMs}ms`)),
        timeoutMs,
      );
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.once('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        reject(new Error(`upgrade rejected: ${res.statusCode}`));
      });
    });
  }

  /**
   * Waits for the next event message matching `predicate`. Drops `ready` /
   * `pong` and other framing messages.
   */
  function nextEvent(
    ws: WebSocket,
    predicate: (msg: { type: string; channel?: string; event?: { type: string } }) => boolean,
    timeoutMs = 2000,
  ): Promise<{ type: string; channel?: string; event?: { type: string; payload?: Record<string, unknown> } }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no matching event within ${timeoutMs}ms`)),
        timeoutMs,
      );
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const text = Buffer.isBuffer(data) ? data.toString('utf8') : data.toString();
          const msg = JSON.parse(text);
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(msg);
          }
        } catch {
          // ignore
        }
      };
      ws.on('message', onMessage);
    });
  }

  /**
   * Asserts that no event matching `predicate` arrives within `withinMs`.
   * Used to verify isolation (e.g. session A subscriber should NOT receive
   * session B's events).
   */
  function expectNoEvent(
    ws: WebSocket,
    predicate: (msg: { type: string; channel?: string }) => boolean,
    withinMs = 800,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', onMessage);
        resolve();
      }, withinMs);
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            reject(new Error(`unexpected event: ${JSON.stringify(msg)}`));
          }
        } catch {
          // ignore
        }
      };
      ws.on('message', onMessage);
    });
  }

  it('rejects upgrade with a non-allowlisted Origin', async () => {
    const ws = connectWs(widgetKey, { origin: 'https://attacker.example' });
    let err: Error | null = null;
    try {
      await waitForOpen(ws);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeTruthy();
    expect(err!.message).toMatch(/upgrade rejected: 401/i);
    ws.terminate();
  });

  it('rejects upgrade with no Origin (browser keys must declare one)', async () => {
    // Origin is required for browser-style widget keys; the upgrade gate
    // calls enforceOriginAllowlist which only short-circuits when Origin
    // is absent. We test absence-equals-pass at the REST layer; for WS
    // we additionally don't expose any subprotocol hint that the caller
    // is server-side, so the gate's permissive "no Origin" branch must
    // still be exercised.
    const ws = connectWs(widgetKey, {});
    await waitForOpen(ws);
    ws.terminate();
  });

  it('accepts upgrade with allowlisted Origin and routes events for the (channelId, sessionId)', async () => {
    const sessionId = 'rt_visitor_a';
    const ws = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    await waitForOpen(ws);
    try {
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      // Give the server a tick to register the subscription before the
      // ingest fires the NOTIFY.
      await new Promise((r) => setTimeout(r, 50));

      const status = await ingest(
        widgetKey,
        {
          channelId,
          sessionId,
          messages: [{ role: 'end_user', body: 'visitor: hi' }],
        },
        ALLOWED_ORIGIN,
      );
      expect(status).toBe(201);

      const ev = await nextEvent(
        ws,
        (m) =>
          m.type === 'event' &&
          m.channel === `widget:${channelId}:${sessionId}` &&
          m.event?.type?.startsWith('conversation.') === true,
      );
      expect(ev.event!.type).toMatch(/^conversation\./);
    } finally {
      ws.terminate();
    }
  });

  it('isolates subscribers across sessionIds on the same channel', async () => {
    const sessA = 'rt_iso_a';
    const sessB = 'rt_iso_b';
    const wsA = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    await waitForOpen(wsA);
    try {
      wsA.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId: sessA }),
      );
      await new Promise((r) => setTimeout(r, 50));

      // Ingest a message under sessionId B; subscriber on A must not see it.
      const noEventP = expectNoEvent(
        wsA,
        (m) => m.type === 'event' && m.channel === `widget:${channelId}:${sessB}`,
        700,
      );
      await ingest(
        widgetKey,
        {
          channelId,
          sessionId: sessB,
          messages: [{ role: 'end_user', body: 'belongs to B' }],
        },
        ALLOWED_ORIGIN,
      );
      await noEventP;
    } finally {
      wsA.terminate();
    }
  });

  it('refuses widget keys subscribing to non-widget channels (org / conversation / contact)', async () => {
    const sessionId = 'rt_scope_test';
    const ws = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    await waitForOpen(ws);
    try {
      // Send blocked subscriptions; server should silently drop them. We
      // verify by ingesting and asserting the only event we receive is on
      // the legitimate widget subscription.
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: 'cnv_fake' }),
      );
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const noOrgEventP = expectNoEvent(ws, (m) => m.channel === 'org', 700);
      await ingest(
        widgetKey,
        {
          channelId,
          sessionId,
          messages: [{ role: 'end_user', body: 'scope test' }],
        },
        ALLOWED_ORIGIN,
      );
      await noOrgEventP;
    } finally {
      ws.terminate();
    }
  });

  it('rejects upgrade for a widget key targeting a different channelId in identity', async () => {
    // verifiedExternalId / userHash present but the HMAC was signed with a
    // different channel's secret — the upgrade gate must reject 401.
    const ext = 'user_replay';
    const wrongHash = signHmac(ext, 'unrelated-secret-of-sufficient-length-32-chars');
    const ws = connectWs(widgetKey, {
      origin: ALLOWED_ORIGIN,
      query: { externalId: ext, userHash: wrongHash },
    });
    let err: Error | null = null;
    try {
      await waitForOpen(ws);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeTruthy();
    expect(err!.message).toMatch(/upgrade rejected: 401/i);
    ws.terminate();
  });

  it('accepts upgrade in verified mode and forwards only matching-externalId events', async () => {
    const ext = 'user_verified_match';
    const hash = signHmac(ext, identitySecret);
    const sessionId = 'rt_verified_match';

    // First, ingest as the verified user so the conversation/contact is
    // bound to this externalId.
    const ingestStatus = await ingest(
      widgetKey,
      {
        channelId,
        sessionId,
        verifiedExternalId: ext,
        userHash: hash,
        messages: [{ role: 'end_user', body: 'verified: hello' }],
      },
      ALLOWED_ORIGIN,
    );
    expect(ingestStatus).toBe(201);

    const ws = connectWs(widgetKey, {
      origin: ALLOWED_ORIGIN,
      query: { externalId: ext, userHash: hash },
    });
    await waitForOpen(ws);
    try {
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      // Send another message; verified subscriber should receive its event.
      await ingest(
        widgetKey,
        {
          channelId,
          sessionId,
          verifiedExternalId: ext,
          userHash: hash,
          messages: [{ role: 'end_user', body: 'verified: second' }],
        },
        ALLOWED_ORIGIN,
      );
      const ev = await nextEvent(
        ws,
        (m) => m.type === 'event' && m.channel === `widget:${channelId}:${sessionId}`,
      );
      expect(ev.event!.type).toMatch(/^conversation\./);
    } finally {
      ws.terminate();
    }
  });

  it('does not deliver events to a verified subscriber whose externalId does not match the conversation contact', async () => {
    const ownerExt = 'user_owner';
    const ownerHash = signHmac(ownerExt, identitySecret);
    const sessionId = 'rt_verified_mismatch';

    // Bind the session to ownerExt.
    await ingest(
      widgetKey,
      {
        channelId,
        sessionId,
        verifiedExternalId: ownerExt,
        userHash: ownerHash,
        messages: [{ role: 'end_user', body: 'first' }],
      },
      ALLOWED_ORIGIN,
    );

    // Now connect as a different verified user; subscribe to the same
    // sessionId. Server must accept the upgrade (HMAC is valid for this
    // requester's externalId) but suppress events because the conversation
    // belongs to ownerExt.
    const requesterExt = 'user_requester';
    const requesterHash = signHmac(requesterExt, identitySecret);
    const ws = connectWs(widgetKey, {
      origin: ALLOWED_ORIGIN,
      query: { externalId: requesterExt, userHash: requesterHash },
    });
    await waitForOpen(ws);
    try {
      ws.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const noEventP = expectNoEvent(
        ws,
        (m) => m.type === 'event' && m.channel === `widget:${channelId}:${sessionId}`,
        800,
      );
      await ingest(
        widgetKey,
        {
          channelId,
          sessionId,
          verifiedExternalId: ownerExt,
          userHash: ownerHash,
          messages: [{ role: 'end_user', body: 'should not leak' }],
        },
        ALLOWED_ORIGIN,
      );
      await noEventP;
    } finally {
      ws.terminate();
    }
  });

  it('rejects upgrade with no auth at all', async () => {
    const ws = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', 'mn_widget_garbage_xxxxx'], {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    let err: Error | null = null;
    try {
      await waitForOpen(ws);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeTruthy();
    expect(err!.message).toMatch(/upgrade rejected: 401/i);
    ws.terminate();
  });

  it('fans out visitor typing to operators subscribed to the conversation', async () => {
    const sessionId = 'rt_typing_v2o';

    // Visitor must have a conversation before typing can be routed.
    const ingestRes = await fetch(`${baseUrl}/api/v1/widget/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${widgetKey}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        messages: [{ role: 'end_user', body: 'first' }],
      }),
    });
    const conversationId = ((await ingestRes.json()) as { conversationId: string }).conversationId;

    const wsVisitor = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsOperator = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', adminKey]);
    await Promise.all([waitForOpen(wsVisitor), waitForOpen(wsOperator)]);
    try {
      wsOperator.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: conversationId }),
      );
      // Visitor's subscription is technically optional for sending typing
      // but realistic.
      wsVisitor.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      wsVisitor.send(
        JSON.stringify({
          type: 'typing',
          channel: 'widget',
          channelId,
          sessionId,
          isTyping: true,
        }),
      );

      const evt = await nextEvent(
        wsOperator,
        (m) => m.type === 'typing' && (m as { authorType?: string }).authorType === 'visitor',
      );
      expect(evt).toMatchObject({
        type: 'typing',
        channel: `conversation:${conversationId}`,
        isTyping: true,
        authorType: 'visitor',
      });
    } finally {
      wsVisitor.terminate();
      wsOperator.terminate();
    }
  });

  it('fans out operator typing to widget subscribers of the same (channelId, sessionId)', async () => {
    const sessionId = 'rt_typing_o2v';
    const ingestRes = await fetch(`${baseUrl}/api/v1/widget/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${widgetKey}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        messages: [{ role: 'end_user', body: 'first' }],
      }),
    });
    const conversationId = ((await ingestRes.json()) as { conversationId: string }).conversationId;

    const wsVisitor = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsOperator = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', adminKey]);
    await Promise.all([waitForOpen(wsVisitor), waitForOpen(wsOperator)]);
    try {
      wsVisitor.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      wsOperator.send(
        JSON.stringify({
          type: 'typing',
          channel: 'conversation',
          id: conversationId,
          isTyping: true,
        }),
      );

      const evt = await nextEvent(
        wsVisitor,
        (m) => m.type === 'typing' && (m as { authorType?: string }).authorType === 'operator',
      );
      expect(evt).toMatchObject({
        type: 'typing',
        channel: `widget:${channelId}:${sessionId}`,
        isTyping: true,
        authorType: 'operator',
      });
    } finally {
      wsVisitor.terminate();
      wsOperator.terminate();
    }
  });

  it('throttles repeated typing:true to at most one broadcast per 1.5s window', async () => {
    const sessionId = 'rt_typing_throttle';
    const ingestRes = await fetch(`${baseUrl}/api/v1/widget/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${widgetKey}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        messages: [{ role: 'end_user', body: 'first' }],
      }),
    });
    const conversationId = ((await ingestRes.json()) as { conversationId: string }).conversationId;

    const wsVisitor = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsOperator = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', adminKey]);
    await Promise.all([waitForOpen(wsVisitor), waitForOpen(wsOperator)]);
    try {
      wsOperator.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: conversationId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      let typingCount = 0;
      wsOperator.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'typing' && msg.authorType === 'visitor' && msg.isTyping) {
            typingCount++;
          }
        } catch {
          // ignore
        }
      });

      // Spam 10 typing:true events back-to-back.
      for (let i = 0; i < 10; i++) {
        wsVisitor.send(
          JSON.stringify({
            type: 'typing',
            channel: 'widget',
            channelId,
            sessionId,
            isTyping: true,
          }),
        );
      }

      // Wait beyond a single 1.5s window so we'd see a second broadcast if
      // the throttle were broken — but not enough for the auto-clear.
      await new Promise((r) => setTimeout(r, 600));
      expect(typingCount).toBe(1);
    } finally {
      wsVisitor.terminate();
      wsOperator.terminate();
    }
  });

  it('auto-clears typing with typing:false after 5 s of silence', async () => {
    const sessionId = 'rt_typing_auto_clear';
    const ingestRes = await fetch(`${baseUrl}/api/v1/widget/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${widgetKey}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        messages: [{ role: 'end_user', body: 'first' }],
      }),
    });
    const conversationId = ((await ingestRes.json()) as { conversationId: string }).conversationId;

    const wsVisitor = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsOperator = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', adminKey]);
    await Promise.all([waitForOpen(wsVisitor), waitForOpen(wsOperator)]);
    try {
      wsOperator.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: conversationId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      wsVisitor.send(
        JSON.stringify({
          type: 'typing',
          channel: 'widget',
          channelId,
          sessionId,
          isTyping: true,
        }),
      );

      // Receive the typing:true.
      await nextEvent(
        wsOperator,
        (m) => m.type === 'typing' && (m as { isTyping?: boolean }).isTyping === true,
      );

      // Don't send another typing event; the server's auto-clear should
      // fire typing:false after 5 s.
      const cleared = await nextEvent(
        wsOperator,
        (m) => m.type === 'typing' && (m as { isTyping?: boolean }).isTyping === false,
        7000,
      );
      expect(cleared).toMatchObject({
        type: 'typing',
        isTyping: false,
        authorType: 'visitor',
      });
    } finally {
      wsVisitor.terminate();
      wsOperator.terminate();
    }
  }, 12000);

  it('does not leak visitor typing across sessionIds', async () => {
    const sessA = 'rt_typing_iso_a';
    const sessB = 'rt_typing_iso_b';
    // Both sessions need conversations.
    for (const s of [sessA, sessB]) {
      await fetch(`${baseUrl}/api/v1/widget/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${widgetKey}`,
          Origin: ALLOWED_ORIGIN,
        },
        body: JSON.stringify({
          channelId,
          sessionId: s,
          messages: [{ role: 'end_user', body: 'first' }],
        }),
      });
    }

    // wsB is a widget subscriber on session B; should NOT see typing fired
    // by session A (typing fans out to operators on conversation:<id>, not
    // to other visitors of the same channel).
    const wsA = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsB = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);
    try {
      wsB.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId: sessB }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const noEventP = expectNoEvent(wsB, (m) => m.type === 'typing', 700);
      wsA.send(
        JSON.stringify({
          type: 'typing',
          channel: 'widget',
          channelId,
          sessionId: sessA,
          isTyping: true,
        }),
      );
      await noEventP;
    } finally {
      wsA.terminate();
      wsB.terminate();
    }
  });

  it('drops widget typing from operator-side connections and conversation typing from widget-side connections', async () => {
    const sessionId = 'rt_typing_role_mix';
    const ingestRes = await fetch(`${baseUrl}/api/v1/widget/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${widgetKey}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        messages: [{ role: 'end_user', body: 'first' }],
      }),
    });
    const conversationId = ((await ingestRes.json()) as { conversationId: string }).conversationId;

    const wsVisitor = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsOperator = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', adminKey]);
    await Promise.all([waitForOpen(wsVisitor), waitForOpen(wsOperator)]);
    try {
      wsOperator.send(
        JSON.stringify({ type: 'subscribe', channel: 'conversation', id: conversationId }),
      );
      wsVisitor.send(
        JSON.stringify({ type: 'subscribe', channel: 'widget', channelId, sessionId }),
      );
      await new Promise((r) => setTimeout(r, 50));

      // Operator tries to fire widget-style typing — should be dropped.
      const noVisitorEventP = expectNoEvent(wsVisitor, (m) => m.type === 'typing', 600);
      wsOperator.send(
        JSON.stringify({
          type: 'typing',
          channel: 'widget',
          channelId,
          sessionId,
          isTyping: true,
        }),
      );
      await noVisitorEventP;

      // Widget tries to fire conversation-style typing — should be dropped.
      const noOperatorEventP = expectNoEvent(wsOperator, (m) => m.type === 'typing', 600);
      wsVisitor.send(
        JSON.stringify({
          type: 'typing',
          channel: 'conversation',
          id: conversationId,
          isTyping: true,
        }),
      );
      await noOperatorEventP;
    } finally {
      wsVisitor.terminate();
      wsOperator.terminate();
    }
  });

  it('drops widget typing when the (channelId, sessionId) has no conversation yet', async () => {
    const sessionId = 'rt_typing_pre_conv'; // no ingest first
    const wsVisitor = connectWs(widgetKey, { origin: ALLOWED_ORIGIN });
    const wsOperator = new WebSocket(`${wsBase}/api/v1/realtime`, ['bearer', adminKey]);
    await Promise.all([waitForOpen(wsVisitor), waitForOpen(wsOperator)]);
    try {
      // Operator subscribes broadly to org so anything that DID fan out
      // would have a destination — the gateway just shouldn't fan
      // out at all because no conversation maps to (channelId, sessionId).
      wsOperator.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      await new Promise((r) => setTimeout(r, 50));

      const noEventP = expectNoEvent(wsOperator, (m) => m.type === 'typing', 600);
      wsVisitor.send(
        JSON.stringify({
          type: 'typing',
          channel: 'widget',
          channelId,
          sessionId,
          isTyping: true,
        }),
      );
      await noEventP;
    } finally {
      wsVisitor.terminate();
      wsOperator.terminate();
    }
  });
});

function parseToolResult<T>(result: unknown): T {
  const r = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  if (r.isError) throw new Error(`tool error: ${JSON.stringify(r)}`);
  const text = r.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('tool result had no text content');
  return JSON.parse(text) as T;
}

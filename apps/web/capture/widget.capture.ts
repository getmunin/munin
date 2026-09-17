import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page, type Route } from '@playwright/test';
import { GREETING, HANDOVER, ORG_NAME, SCRIPT, type ScriptedMessage } from './transcript';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const widgetDist = join(repoRoot, 'apps/chat-widget/dist');

const SITE = 'https://shop.acme.test/';
const API = 'https://api.acme.test';
const WS = 'wss://api.acme.test/v1/realtime';
const CHANNEL_ID = 'chan_demo';
const CONVERSATION_ID = 'conv_demo';

interface ListedMessage {
  id: string;
  role: string;
  authorKind: string | null;
  authorName: string | null;
  body: string;
  bodyHtml: null;
  at: string;
  readAt: null;
}

function readBundle(): string {
  const manifest = JSON.parse(readFileSync(join(widgetDist, 'manifest.json'), 'utf8')) as {
    current: string;
  };
  return readFileSync(join(widgetDist, manifest.current), 'utf8');
}

function stageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${ORG_NAME}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font: 16px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
        color: #11181c;
        background: #f6f7f9;
      }
      header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 20px 56px; background: #fff; border-bottom: 1px solid #e6e8eb;
      }
      .brand { font-weight: 650; letter-spacing: -0.01em; }
      nav { display: flex; gap: 28px; color: #5f6b76; font-size: 14px; }
      main { padding: 72px 56px; max-width: 1180px; }
      h1 { font-size: 46px; line-height: 1.1; letter-spacing: -0.03em; margin: 0 0 16px; max-width: 16ch; }
      p.lede { font-size: 18px; color: #5f6b76; margin: 0 0 32px; max-width: 46ch; }
      .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 56px; }
      .card { background: #fff; border: 1px solid #e6e8eb; border-radius: 14px; padding: 20px; }
      .swatch { height: 104px; border-radius: 10px; background: #e9edf2; margin-bottom: 14px; }
      .card h3 { margin: 0 0 4px; font-size: 15px; }
      .card span { color: #5f6b76; font-size: 14px; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">${ORG_NAME}</div>
      <nav><span>Cookware</span><span>Appliances</span><span>Offers</span><span>Support</span></nav>
    </header>
    <main>
      <h1>Kitchen kit that lasts a lifetime</h1>
      <p class="lede">Free delivery on orders over 900. Next working day dispatch from our own warehouse.</p>
      <div class="cards">
        <div class="card"><div class="swatch"></div><h3>Stand mixer</h3><span>In stock</span></div>
        <div class="card"><div class="swatch"></div><h3>Cast iron pan</h3><span>In stock</span></div>
        <div class="card"><div class="swatch"></div><h3>Knife block</h3><span>Ships Monday</span></div>
      </div>
    </main>
    <script
      src="/widget.js"
      data-munin-host="${API}"
      data-widget-key="mn_widget_demo"
      data-channel-id="${CHANNEL_ID}"
      data-munin-theme-color="#0066FF"
      data-munin-position="bottom-right"
      data-munin-greeting="${GREETING}"
      data-munin-org-name="${ORG_NAME}"
      data-munin-eyebrow="${ORG_NAME} · powered by Munin"
      data-munin-size="standard"
    ></script>
  </body>
</html>`;
}

class Transcript {
  private readonly delivered: ListedMessage[] = [];
  private clock = Date.parse('2026-01-05T09:00:00.000Z');

  private next(): string {
    this.clock += 45_000;
    return new Date(this.clock).toISOString();
  }

  add(message: Omit<ListedMessage, 'at' | 'bodyHtml' | 'readAt'>): void {
    this.delivered.push({ ...message, bodyHtml: null, readAt: null, at: this.next() });
  }

  since(raw: string | null): ListedMessage[] {
    if (!raw) return [...this.delivered];
    const cutoff = Date.parse(raw);
    return this.delivered.filter((m) => Date.parse(m.at) > cutoff);
  }

  cursor(): string | null {
    const last = this.delivered.at(-1);
    return last ? last.at : null;
  }
}

async function mockWidgetApi(page: Page, transcript: Transcript): Promise<void> {
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

  await page.route(`${API}/v1/widget/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/v1/widget', '');

    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }

    if (path === '/conversations' && request.method() === 'POST') {
      return json(route, { conversationId: CONVERSATION_ID, displayId: 1, contactId: 'contact_demo' });
    }
    if (path === '/conversations') return json(route, { conversations: [] });

    if (path === '/messages' && request.method() === 'POST') {
      const payload = request.postDataJSON() as { messages: { body: string }[] };
      for (const message of payload.messages) {
        transcript.add({
          id: `msg_visitor_${Math.random().toString(36).slice(2, 10)}`,
          role: 'end_user',
          authorKind: null,
          authorName: null,
          body: message.body,
        });
      }
      return json(route, {
        conversationId: CONVERSATION_ID,
        displayId: 1,
        contactId: 'contact_demo',
        inserted: payload.messages.length,
        skipped: 0,
      });
    }

    if (path === '/messages') {
      return json(route, {
        messages: transcript.since(url.searchParams.get('since')),
        hasMore: false,
        cursor: transcript.cursor(),
        conversation: {
          id: CONVERSATION_ID,
          subject: 'Delivery address change',
          status: 'open',
          handedOver: false,
          assigneeName: null,
          agentName: 'Munin',
          contactEmail: 'ola.nordmann@example.com',
        },
      });
    }

    if (path === '/voice/available') return json(route, { available: false, reason: 'not_configured' });
    if (path === '/visitor') return json(route, {});
    return json(route, {});
  });
}

test('chat widget answers a customer and hands off to a human', async ({ page }, testInfo) => {
  const transcript = new Transcript();
  const socket = {
    event: (): void => {},
    typing: (_isTyping: boolean): void => {},
  };

  await page.routeWebSocket(`${WS}*`, (ws) => {
    socket.event = () => ws.send(JSON.stringify({ type: 'event', channel: 'widget' }));
    socket.typing = (isTyping: boolean) =>
      ws.send(JSON.stringify({ type: 'typing', authorType: 'operator', isTyping }));
    ws.onMessage(() => {});
  });

  await mockWidgetApi(page, transcript);
  await page.route(`${SITE}widget.js`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: readBundle() }),
  );
  await page.route(SITE, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: stageHtml() }),
  );

  await page.goto(SITE);
  await page.waitForTimeout(1200);

  const launcher = page.locator('[data-munin-widget] button.launcher');
  await launcher.click();
  await page.waitForTimeout(1600);

  await page.locator('[data-munin-widget] [data-act="start"]').click();
  await page.waitForTimeout(1000);

  const composer = page.locator('[data-munin-widget] textarea');

  const deliver = async (reply: ScriptedMessage) => {
    socket.typing(true);
    await page.waitForTimeout(reply.typingMs);
    transcript.add({
      id: reply.id,
      role: reply.role,
      authorKind: reply.authorKind,
      authorName: reply.authorName,
      body: reply.body,
    });
    socket.typing(false);
    socket.event();
    await page.waitForTimeout(reply.pauseMs);
  };

  for (const exchange of SCRIPT) {
    await composer.click();
    await composer.pressSequentially(exchange.ask, { delay: 28 });
    await page.waitForTimeout(400);
    await composer.press('Enter');
    await page.waitForTimeout(500);
    socket.event();
    await page.waitForTimeout(700);
    await deliver(exchange.reply);
  }

  await deliver(HANDOVER);
  await page.waitForTimeout(2200);

  const panel = page.locator('[data-munin-widget] .panel');
  const box = await panel.boundingBox();
  if (!box) throw new Error('widget panel has no bounding box');

  const pad = 24;
  const crop = {
    x: Math.max(0, Math.round(box.x - pad)),
    y: Math.max(0, Math.round(box.y - pad)),
    width: Math.round(box.width + pad * 2),
    height: Math.round(box.height + pad * 2),
  };
  mkdirSync(join(here, '.artifacts'), { recursive: true });
  writeFileSync(join(here, '.artifacts/widget-crop.json'), JSON.stringify(crop, null, 2));

  await page.locator('body').click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(here, '.artifacts/widget-still.png'), clip: crop });
  testInfo.annotations.push({ type: 'crop', description: JSON.stringify(crop) });
});

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

export const DEMO = {
  apiUrl: process.env.MUNIN_CAPTURE_API_URL ?? 'http://localhost:3001',
  email: process.env.MUNIN_CAPTURE_EMAIL ?? 'demo@example.com',
  password: process.env.MUNIN_CAPTURE_PASSWORD ?? 'capture-only-password-01',
  name: 'Demo Operator',
  orgName: 'Acme Kitchen',
};

const WIDGET_ORIGIN = 'https://shop.acme.test';
const OUTREACH_CHANNEL_KEY = 'ch_email';

interface ImportResult {
  created: number;
  skipped: number;
  idMap?: Record<string, string>;
  warnings?: string[];
}

interface WidgetChannel {
  id: string;
  widgetKey: string;
}

interface EmailChannel {
  id: string;
}

interface CreatedApiKey {
  key: string;
}

interface ConversationListResult {
  items?: unknown[];
}

interface IngestResult {
  conversationId: string;
}

interface ProviderStub {
  baseUrl: string;
  close: () => Promise<void>;
}

interface Thread {
  visitor: { name: string; email: string };
  turns: { from: 'visitor' | 'agent'; body: string }[];
}

interface CurationCandidate {
  sourceVisitorEmail: string;
  subject: string;
  draftBody: string;
  proposedTargetSpaceSlug: string;
}

interface JsonRpcResponse {
  error?: unknown;
  result?: { isError?: boolean };
}

interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
}

function collectCookies(response: Response, jar: Map<string, string>): string {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1));
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const res = await fetch(`${DEMO.apiUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: DEMO.apiUrl,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function startProviderStub(): Promise<ProviderStub> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5-20251001' }] }));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function signInCookie(): Promise<string> {
  const jar = new Map<string, string>();
  const signUp = await fetch(`${DEMO.apiUrl}/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: DEMO.apiUrl },
    body: JSON.stringify({ email: DEMO.email, password: DEMO.password, name: DEMO.name }),
  });
  if (signUp.ok) return collectCookies(signUp, jar);

  const signIn = await call('/auth/sign-in/email', {
    method: 'POST',
    body: { email: DEMO.email, password: DEMO.password },
  });
  return collectCookies(signIn, jar);
}

async function configureProvider(cookie: string): Promise<void> {
  const provider = await startProviderStub();
  try {
    await call('/v1/agent-config', {
      method: 'PUT',
      cookie,
      body: {
        fastModel: 'claude-haiku-4-5-20251001',
        smartModel: 'claude-sonnet-5',
        providerBaseUrl: provider.baseUrl,
        providerApiKey: 'capture-only-not-a-real-key',
      },
    });
  } finally {
    await provider.close();
  }
}

async function widgetChannel(cookie: string): Promise<WidgetChannel> {
  const res = await call('/v1/conversations/channels/widget', {
    method: 'POST',
    cookie,
    body: { name: 'Website chat', originAllowlist: [WIDGET_ORIGIN] },
  });
  return readJson<WidgetChannel>(res);
}

async function emailChannel(cookie: string): Promise<EmailChannel> {
  const res = await call('/v1/conversations/channels/email', {
    method: 'POST',
    cookie,
    body: {
      name: 'Sales email',
      config: {
        addressing: { fromAddress: 'hei@acme.example.com', fromName: DEMO.orgName },
        outbound: {
          provider: 'smtp',
          host: 'smtp.acme.example.com',
          port: 587,
          secure: false,
          username: 'hei@acme.example.com',
          password: 'capture-only-not-a-real-password',
        },
      },
    },
  });
  return readJson<EmailChannel>(res);
}

async function adminKey(cookie: string): Promise<string> {
  const res = await call('/v1/api-keys', {
    method: 'POST',
    cookie,
    body: { name: 'capture seed', scopes: ['*'] },
  });
  return (await readJson<CreatedApiKey>(res)).key;
}

async function seedConversations(cookie: string, key: string): Promise<Map<string, string>> {
  const threads = JSON.parse(readFileSync(join(fixtures, 'threads.json'), 'utf8')) as Thread[];
  const widget = await widgetChannel(cookie);
  const byVisitor = new Map<string, string>();

  for (const [index, thread] of threads.entries()) {
    const sessionId = `capture-session-${index + 1}`;
    let conversationId: string | null = null;

    for (const turn of thread.turns) {
      if (turn.from === 'visitor') {
        const res = await fetch(`${DEMO.apiUrl}/v1/widget/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${widget.widgetKey}`,
            origin: WIDGET_ORIGIN,
          },
          body: JSON.stringify({
            channelId: widget.id,
            sessionId,
            visitor: thread.visitor,
            messages: [{ role: 'end_user', body: turn.body }],
          }),
        });
        if (!res.ok) throw new Error(`widget ingest → ${res.status} ${await res.text()}`);
        conversationId = (await readJson<IngestResult>(res)).conversationId;
        continue;
      }

      const res = await fetch(`${DEMO.apiUrl}/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ body: turn.body, internal: false }),
      });
      if (!res.ok) throw new Error(`agent reply → ${res.status} ${await res.text()}`);
    }

    if (conversationId) byVisitor.set(thread.visitor.email, conversationId);
  }

  return byVisitor;
}

async function callTool(key: string, name: string, args: unknown): Promise<void> {
  const res = await fetch(`${DEMO.apiUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const frame = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  const payload = frame ? (JSON.parse(frame) as JsonRpcResponse) : null;
  if (!res.ok || !payload || payload.error || payload.result?.isError) {
    throw new Error(`${name} → ${res.status} ${text}`);
  }
}

async function seedCuration(key: string, conversations: Map<string, string>): Promise<number> {
  const candidates = JSON.parse(
    readFileSync(join(fixtures, 'curation.json'), 'utf8'),
  ) as CurationCandidate[];

  for (const candidate of candidates) {
    const sourceConversationId = conversations.get(candidate.sourceVisitorEmail);
    if (!sourceConversationId) {
      throw new Error(`no seeded conversation for ${candidate.sourceVisitorEmail}`);
    }
    await callTool(key, 'kb_propose_curation_candidate', {
      subject: candidate.subject,
      draftBody: candidate.draftBody,
      proposedTargetSpaceSlug: candidate.proposedTargetSpaceSlug,
      sourceConversationId,
    });
  }

  return candidates.length;
}

async function seedOutreach(cookie: string, idMap: Record<string, string>): Promise<number> {
  const records = JSON.parse(readFileSync(join(fixtures, 'outreach.json'), 'utf8')) as unknown;
  const channel = await emailChannel(cookie);
  const res = await call('/v1/outreach/import', {
    method: 'POST',
    cookie,
    body: { records, idMap: { ...idMap, [OUTREACH_CHANNEL_KEY]: channel.id } },
  });
  const result = await readJson<ImportResult>(res);
  for (const warning of result.warnings ?? []) {
    if (warning.includes('skipped')) throw new Error(`outreach import: ${warning}`);
  }
  return result.created;
}

async function assertEmptyInbox(cookie: string): Promise<void> {
  const res = await call('/v1/conversations', { cookie });
  const existing = await readJson<ConversationListResult>(res);
  if ((existing.items ?? []).length > 0) {
    throw new Error(
      'this org already has conversations — seeding again would duplicate them. Reset the scratch database first (see capture/README.md).',
    );
  }
}

export async function seed(): Promise<void> {
  const cookie = await signInCookie();
  if (!cookie) throw new Error('no session cookie after sign-in');

  await assertEmptyInbox(cookie);

  await call('/v1/orgs/me', { method: 'PATCH', cookie, body: { name: DEMO.orgName } });
  await configureProvider(cookie);

  const idMap: Record<string, string> = {};
  for (const module of ['kb', 'crm']) {
    const records = JSON.parse(readFileSync(join(fixtures, `${module}.json`), 'utf8')) as unknown;
    const res = await call(`/v1/${module}/import`, { method: 'POST', cookie, body: { records } });
    const result = await readJson<ImportResult>(res);
    Object.assign(idMap, result.idMap ?? {});
    console.log(`seeded ${module}: created ${result.created}, skipped ${result.skipped}`);
  }

  const key = await adminKey(cookie);
  const conversations = await seedConversations(cookie, key);
  console.log(`seeded ${conversations.size} conversations through the widget channel`);

  const proposals = await seedOutreach(cookie, idMap);
  console.log(`seeded ${proposals} outreach records awaiting review`);

  const candidates = await seedCuration(key, conversations);
  console.log(`seeded ${candidates} curation candidates awaiting review`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => console.log('seed complete'))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

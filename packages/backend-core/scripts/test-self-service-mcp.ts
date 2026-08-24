import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';

const PORT = Number(process.env.PORT ?? 4123);
const TOKEN = process.env.MCP_BEARER_TOKEN ?? 'test_token_1234567890';
const TLS_KEY = process.env.TLS_KEY;
const TLS_CERT = process.env.TLS_CERT;
const SCHEME = TLS_KEY && TLS_CERT ? 'https' : 'http';
const SELF_URL = process.env.SELF_URL ?? `${SCHEME}://localhost:${PORT}`;
const ISSUER = process.env.MUNIN_ISSUER ?? 'http://localhost:3001';
const ORG_ID = process.env.MUNIN_ORG_ID;
const JWKS_URL = ORG_ID ? `${ISSUER}/v1/public/connectors/${ORG_ID}/jwks` : null;
const JWKS = JWKS_URL ? createRemoteJWKSet(new URL(JWKS_URL)) : null;

type Provenance = 'authenticated' | 'channel_asserted' | 'self_reported' | 'none';

interface Subscription {
  ref: string;
  plan: string;
  status: string;
  price: string;
  renewsOn?: string;
  endedOn?: string;
}

interface Caller {
  email: string | null;
  provenance: Provenance;
}

const SUBSCRIPTIONS: Record<string, Subscription[]> = {
  'jane@example.com': [
    { ref: 'SUB-1001', plan: 'Pro annual', status: 'active', renewsOn: '2027-03-01', price: 'NOK 4 990' },
    { ref: 'SUB-0912', plan: 'Starter monthly', status: 'cancelled', endedOn: '2026-01-14', price: 'NOK 249' },
  ],
  'ola@example.com': [
    { ref: 'SUB-2044', plan: 'Team monthly', status: 'past_due', renewsOn: '2026-09-01', price: 'NOK 1 490' },
  ],
};

const RANK: Record<Provenance, number> = {
  none: 0,
  self_reported: 0,
  channel_asserted: 1,
  authenticated: 2,
};

const ANONYMOUS: Caller = { email: null, provenance: 'none' };

async function identify(header: string | undefined): Promise<Caller> {
  if (!header) return ANONYMOUS;
  if (!JWKS) {
    console.warn('  [warn] MUNIN_ORG_ID unset — assertion not verified, treating caller as anonymous');
    return ANONYMOUS;
  }
  const { payload } = await jwtVerify(header, JWKS, { issuer: ISSUER, audience: SELF_URL });
  const provenance = payload.email_provenance;
  return {
    email: typeof payload.email === 'string' ? payload.email : null,
    provenance: isProvenance(provenance) ? provenance : 'none',
  };
}

function isProvenance(value: unknown): value is Provenance {
  return value === 'authenticated' || value === 'channel_asserted' || value === 'self_reported';
}

function allows(caller: Caller, minimum: Provenance): boolean {
  return caller.email !== null && RANK[caller.provenance] >= RANK[minimum];
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function refuse(minimum: Provenance, caller: Caller) {
  return text(
    `Refused: this tool needs at least "${minimum}" identity, caller is "${caller.provenance}". Ask the customer to write in from their registered address, or verify them another way.`,
  );
}

function buildServer(caller: Caller): McpServer {
  const server = new McpServer({ name: 'test-self-service-crm', version: '1.0.0' });

  server.registerTool(
    'list_subscriptions',
    {
      description: "The calling customer's subscriptions, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(25).default(10) },
      annotations: { readOnlyHint: true },
    },
    (args: { limit?: number }) => {
      if (!allows(caller, 'channel_asserted')) return refuse('channel_asserted', caller);
      const rows = (caller.email ? (SUBSCRIPTIONS[caller.email] ?? []) : []).slice(0, args.limit ?? 10);
      return text(JSON.stringify(rows));
    },
  );

  server.registerTool(
    'get_invoice_link',
    {
      description: 'A short-lived link to one of the calling customer’s invoices.',
      inputSchema: { subscriptionRef: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    (args: { subscriptionRef: string }) => {
      const subscriptionRef = args.subscriptionRef;
      if (!allows(caller, 'authenticated')) return refuse('authenticated', caller);
      const owned = (caller.email ? (SUBSCRIPTIONS[caller.email] ?? []) : []).some(
        (s) => s.ref === subscriptionRef,
      );
      if (!owned) return text(JSON.stringify({ error: 'not found for this customer' }));
      return text(
        JSON.stringify({ url: `https://billing.example.com/invoices/${subscriptionRef}?t=demo` }),
      );
    },
  );

  server.registerTool(
    'cancel_subscription',
    {
      description: 'Cancels one of the calling customer’s subscriptions at the end of the period.',
      inputSchema: { subscriptionRef: z.string().min(1) },
      annotations: { destructiveHint: true },
    },
    (args: { subscriptionRef: string }) => {
      if (!allows(caller, 'authenticated')) return refuse('authenticated', caller);
      return text(JSON.stringify({ cancelled: args.subscriptionRef, effective: 'end of current period' }));
    },
  );

  server.registerTool(
    'get_opening_hours',
    {
      description: 'Support opening hours. Needs no customer identity.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => text(JSON.stringify({ weekdays: '08:00–16:00 CET', weekend: 'closed' })),
  );

  return server;
}

async function serve(req: IncomingMessage, res: ServerResponse, body: Buffer): Promise<void> {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    console.log(`  ${req.method ?? 'GET'} ${req.url ?? '/'} -> 401 (bad or missing bearer token)`);
    res.writeHead(401).end();
    return;
  }
  let caller = ANONYMOUS;
  try {
    caller = await identify(readHeader(req.headers['x-munin-identity']));
  } catch (err) {
    console.log(`  assertion rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  const request = new Request(`${SELF_URL}${req.url ?? '/'}`, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      typeof v === 'string' ? [[k, v] as [string, string]] : [],
    ),
    body: body.length ? body : undefined,
    duplex: 'half',
  });
  const out = await createMcpHandler(() => buildServer(caller)).fetch(request);
  const label = caller.email ? `${caller.email} (${caller.provenance})` : 'anonymous';
  console.log(`  ${req.method ?? 'GET'} ${req.url ?? '/'} -> ${out.status}  caller: ${label}`);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(out.body ? Buffer.from(await out.arrayBuffer()) : undefined);
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function onRequest(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    void serve(req, res, Buffer.concat(chunks)).catch((err: unknown) => {
      console.error('  handler failed:', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

const httpServer =
  TLS_KEY && TLS_CERT
    ? createHttpsServer({ key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) }, onRequest)
    : createHttpServer(onRequest);

httpServer.listen(PORT, () => {
  console.log(`test self-service MCP server on ${SELF_URL} (${SCHEME})`);
  console.log(`  bearer token : ${TOKEN}`);
  console.log(`  assertions   : ${JWKS_URL ?? 'NOT VERIFIED (set MUNIN_ORG_ID to enable)'}`);
  console.log(`  known emails : ${Object.keys(SUBSCRIPTIONS).join(', ')}`);
  console.log('  tools        : list_subscriptions, get_invoice_link, cancel_subscription, get_opening_hours');
  console.log('');
  console.log('  SELF_URL must match the URL registered in Munin, or audience checks fail.');
});

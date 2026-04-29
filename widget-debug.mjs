import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import postgres from 'postgres';
import { AppModule } from '/Users/kjell/Source/munin/munin/packages/backend-core/dist/app.module.js';
import { runMigrations, schema, createDb } from '/Users/kjell/Source/munin/munin/packages/db/dist/index.js';
import { buildApiKey, hashSecret, keyPrefix } from '/Users/kjell/Source/munin/munin/packages/core/dist/index.js';
import { sql } from 'drizzle-orm';

const TEST_URL = 'postgres://munin:munin@127.0.0.1:5432/munin_phase5_smoke';
const APP_URL = 'postgres://munin_app:munin_app@127.0.0.1:5432/munin_phase5_smoke';

process.env.MUNIN_AUTH_SECRET = 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
process.env.MUNIN_KEY_PEPPER = 'test-pepper';
process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
process.env.MUNIN_MAIL_PROVIDER = 'stub';
process.env.MUNIN_STORAGE_PROVIDER = 'local';
process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-test-assets';
process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
process.env.DATABASE_URL = APP_URL;

await runMigrations(TEST_URL);
const db = createDb(TEST_URL, { serviceRole: true });
const ts = Date.now();
const [org] = await db.insert(schema.orgs).values({ name: 'Debug', slug: `debug-${ts}` }).returning();
const orgId = org.id;
const adminKey = buildApiKey('admin');
await db.insert(schema.apiKeys).values({
  orgId, type: 'admin', name: 'debug-admin',
  keyHash: hashSecret(adminKey), keyPrefix: keyPrefix(adminKey), scopes: ['*'],
});

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
await app.listen(0, '127.0.0.1');
const addr = app.getHttpServer().address();
const baseUrl = `http://127.0.0.1:${addr.port}`;
console.log('listening on', baseUrl);

const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
});
const c = new Client({ name: 'debug', version: '0.0.0' });
await c.connect(transport);
const tools = await c.listTools();
console.log('TOOL NAMES:', tools.tools.map(t => t.name).filter(n => n.includes('widget')));

const result = await c.callTool({
  name: 'conv_widget_create_channel',
  arguments: { name: 'foo', displayName: 'Foo', originAllowlist: ['https://example.com'] },
});
console.log('RESULT:', JSON.stringify(result, null, 2));

const channels = await db.select().from(schema.convChannels).where(sql`org_id = ${orgId}`);
console.log('CHANNELS:', channels);
const keys = await db.select().from(schema.apiKeys).where(sql`org_id = ${orgId} AND type = 'widget'`);
console.log('KEYS:', keys);

await transport.close();
await c.close();
await db.delete(schema.orgs).where(sql`id = ${orgId}`);
await app.close();
process.exit(0);

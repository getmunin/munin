import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql, eq } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';
import { DnsProbeSendingIdentityProvider } from './dns-probe.provider.ts';
import { SendingIdentityRefreshWorker } from './sending-identity-refresh.worker.ts';
import { dkimRecordValue, extractPublicKeyFromRecord, stripPem } from './dkim-key.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run sending identity integration tests.';

interface IdentityDto {
  id: string;
  domain: string;
  selector: string;
  status: string;
  records: { type: string; name: string; value: string }[];
  lastError: string | null;
}

(skipReason ? describe.skip : describe)('Sending identities: DKIM record lifecycle', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let orgId: string;
  let adminKey: string;
  let provider: DnsProbeSendingIdentityProvider;
  let worker: SendingIdentityRefreshWorker;
  const published = new Map<string, string[][]>();

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = '1';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(
      /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
      '$1munin_app:munin_app@',
    );
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db.insert(schema.orgs).values({ name: 'Identity IT Org' }).returning();
    orgId = org!.id;

    adminKey = buildApiKey('admin');
    await db.insert(schema.apiKeys).values({
      orgId,
      type: 'admin',
      name: 'identity-it-admin',
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

    provider = app.get(DnsProbeSendingIdentityProvider);
    worker = app.get(SendingIdentityRefreshWorker);
    provider.setResolver((host) => {
      const found = published.get(host);
      if (found) return Promise.resolve(found);
      const err = new Error('queryTxt ENOTFOUND') as Error & { code?: string };
      err.code = 'ENOTFOUND';
      return Promise.reject(err);
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id = ${orgId}`);
    }
  });

  async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${adminKey}` } },
    });
    const client = new Client({ name: 'munin-identity-it', version: '0.0.0' });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name, arguments: args });
      if ((result as { isError?: boolean }).isError) {
        throw new Error(`${name} failed: ${JSON.stringify(result)}`);
      }
      const content = (result as { content: { type: string; text: string }[] }).content;
      const text = content.find((c) => c.type === 'text')?.text ?? 'null';
      return JSON.parse(text) as T;
    } finally {
      await transport.close();
      await client.close();
    }
  }

  let identity: IdentityDto;

  it('returns one portable TXT record that names no mail vendor', async () => {
    identity = await call<IdentityDto>('conv_create_sending_identity', { domain: 'ACME.test ' });

    expect(identity.domain).toBe('acme.test');
    expect(identity.status).toBe('pending');
    expect(identity.records).toHaveLength(1);

    const record = identity.records[0]!;
    expect(record.type).toBe('TXT');
    expect(record.name).toBe(`${identity.selector}._domainkey.acme.test`);
    expect(record.value.startsWith('v=DKIM1; k=rsa; p=')).toBe(true);
    expect(record.value).not.toContain('amazonses');
    expect(record.value).not.toContain('amazonaws');
  });

  it('never exposes the private key through the tool surface', async () => {
    const listed = await call<IdentityDto[]>('conv_list_sending_identities');
    expect(JSON.stringify(listed)).not.toContain('PRIVATE KEY');
  });

  it('stores the private key encrypted, not in plaintext', async () => {
    const rows = await db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, identity.id));
    const row = rows[0]!;
    expect(row.privateKeyPem).not.toContain('BEGIN PRIVATE KEY');
    expect(row.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(extractPublicKeyFromRecord(identity.records[0]!.value)).toBe(stripPem(row.publicKeyPem));
  });

  it('stays pending while the record is not published, and says why', async () => {
    const refreshed = await call<IdentityDto>('conv_refresh_sending_identity', {
      identityId: identity.id,
    });
    expect(refreshed.status).toBe('pending');
    expect(refreshed.lastError).toContain('no TXT record');
  });

  it('verifies once the customer publishes the record', async () => {
    const rows = await db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, identity.id));
    published.set(identity.records[0]!.name, [[dkimRecordValue(rows[0]!.publicKeyPem)]]);

    const refreshed = await call<IdentityDto>('conv_refresh_sending_identity', {
      identityId: identity.id,
    });
    expect(refreshed.status).toBe('verified');
    expect(refreshed.lastError).toBeNull();
  });

  it('refuses a second identity for the same domain', async () => {
    await expect(call('conv_create_sending_identity', { domain: 'acme.test' })).rejects.toThrow(
      /already has a sending identity/,
    );
  });

  it('rejects an email address in place of a domain', async () => {
    await expect(
      call('conv_create_sending_identity', { domain: 'support@acme.test' }),
    ).rejects.toThrow(/is not a domain/);
  });

  it('picks up newly published records in the background worker', async () => {
    const created = await call<IdentityDto>('conv_create_sending_identity', {
      domain: 'second.test',
    });
    expect(created.status).toBe('pending');

    const rows = await db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, created.id));
    published.set(created.records[0]!.name, [[dkimRecordValue(rows[0]!.publicKeyPem)]]);

    const result = await worker.tick();
    expect(result.verified).toBeGreaterThanOrEqual(1);

    const after = await db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, created.id));
    expect(after[0]!.status).toBe('verified');
    expect(after[0]!.verifiedAt).not.toBeNull();
  });

  it('deletes an identity and its key', async () => {
    const created = await call<IdentityDto>('conv_create_sending_identity', {
      domain: 'third.test',
    });
    await call('conv_delete_sending_identity', { identityId: created.id });
    const rows = await db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, created.id));
    expect(rows).toHaveLength(0);
  });
});

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { buildApiKey, hashSecret, keyPrefix } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run sending identity REST tests.';

interface IdentityDto {
  id: string;
  domain: string;
  status: string;
  records: { type: string; name: string; value: string }[];
}

(skipReason ? describe.skip : describe)(
  'Sending identities: REST surface the dashboard uses',
  () => {
    let app: INestApplication;
    let baseUrl: string;
    let db: ReturnType<typeof createDb>;
    let orgId: string;
    let adminKey: string;

    beforeAll(async () => {
      process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';
      process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
      process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
      process.env.MUNIN_MAIL_PROVIDER = 'stub';
      process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';

      await runMigrations(TEST_URL!);
      process.env.DATABASE_URL = TEST_URL!.replace(
        /(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/,
        '$1munin_app:munin_app@',
      );

      db = createDb(TEST_URL!, { serviceRole: true });
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      const [org] = await db.insert(schema.orgs).values({ name: 'Identity REST Org' }).returning();
      orgId = org!.id;

      adminKey = buildApiKey('admin');
      await db.insert(schema.apiKeys).values({
        orgId,
        type: 'admin',
        name: 'identity-rest-admin',
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
    });

    afterAll(async () => {
      if (app) await app.close();
      if (db) {
        await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
        await db.delete(schema.orgs).where(sql`id = ${orgId}`);
      }
    });

    function rest(path: string, init?: RequestInit) {
      return fetch(`${baseUrl}/v1/conversations/sending-identities${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
          ...(init?.headers ?? {}),
        },
      });
    }

    it('refuses an unauthenticated caller', async () => {
      const res = await fetch(`${baseUrl}/v1/conversations/sending-identities`);
      expect(res.status).toBe(401);
    });

    it('creates, lists, refreshes and deletes over REST', async () => {
      const created = await rest('', {
        method: 'POST',
        body: JSON.stringify({ domain: 'rest.test' }),
      });
      expect(created.status).toBe(200);
      const identity = (await created.json()) as IdentityDto;
      expect(identity.domain).toBe('rest.test');
      expect(identity.records).toHaveLength(1);

      const listed = await rest('');
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { items: IdentityDto[] };
      expect(body.items.map((i) => i.domain)).toContain('rest.test');

      const refreshed = await rest(`/${identity.id}/refresh`, { method: 'POST' });
      expect(refreshed.status).toBe(200);
      expect(((await refreshed.json()) as IdentityDto).status).toBe('pending');

      const deleted = await rest(`/${identity.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);

      const after = await rest('');
      const afterBody = (await after.json()) as { items: IdentityDto[] };
      expect(afterBody.items.map((i) => i.domain)).not.toContain('rest.test');
    });

    it('reports identity outbound as unavailable on a stock OSS instance', async () => {
      const res = await fetch(`${baseUrl}/v1/conversations/channels/email/capabilities`, {
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ identityOutbound: { available: false } });
    });

    it('rejects a malformed domain with 400, not 500', async () => {
      const res = await rest('', {
        method: 'POST',
        body: JSON.stringify({ domain: 'support@rest.test' }),
      });
      expect(res.status).toBe(400);
    });
  },
);

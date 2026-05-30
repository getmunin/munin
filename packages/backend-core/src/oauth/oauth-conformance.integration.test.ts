import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { runMigrations } from '@getmunin/db';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run OAuth conformance tests.';

(skipReason ? describe.skip : describe)('OAuth 2.1 / MCP resource-server conformance', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-oauth-rs-it';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.NEXT_PUBLIC_MCP_URL = `${baseUrl}/mcp`;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.NEXT_PUBLIC_MCP_URL;
  });

  describe('RFC 9728: Protected resource metadata', () => {
    it('serves the metadata at /.well-known/oauth-protected-resource', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.resource).toBe(`${baseUrl}/mcp`);
      expect(body.authorization_servers).toEqual([baseUrl]);
      expect(body.bearer_methods_supported).toEqual(['header']);
      expect(body.resource_indicators_supported).toBe(true);
      expect(Array.isArray(body.scopes_supported)).toBe(true);
      expect(body.scopes_supported).toContain('mcp:tools');
    });
  });

  describe('MCP authorization spec: WWW-Authenticate on 401', () => {
    it('emits Bearer challenge with resource_metadata for /mcp', async () => {
      const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
      expect(res.status).toBe(401);
      const challenge = res.headers.get('www-authenticate') ?? '';
      expect(challenge).toContain('Bearer');
      expect(challenge).toContain('resource_metadata="');
      expect(challenge).toContain('/.well-known/oauth-protected-resource');
    });

    it('does NOT emit the resource_metadata challenge for non-/mcp routes', async () => {
      const res = await fetch(`${baseUrl}/v1/whoami`);
      expect(res.status).toBe(401);
      const challenge = res.headers.get('www-authenticate') ?? '';
      expect(challenge).not.toContain('resource_metadata');
    });
  });
});

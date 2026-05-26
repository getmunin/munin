import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createApp } from '@getmunin/backend-core';
import { runMigrations } from '@getmunin/db';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run OAuth AS conformance tests.';

const FIXED_PORT = 17345;
const PRESET_BASE_URL = `http://127.0.0.1:${FIXED_PORT}`;

(skipReason ? describe.skip : describe)('OAuth 2.1 / MCP authorization-server conformance', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-oauth-as-it';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';
    process.env.MUNIN_MCP_URL = PRESET_BASE_URL;

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    app = await createApp(AppModule, { logger: false });
    await app.listen(FIXED_PORT, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = PRESET_BASE_URL;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.MUNIN_MCP_URL;
  });

  describe('RFC 8414: Authorization server metadata', () => {
    it('serves the metadata at /.well-known/oauth-authorization-server', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;

      expect(typeof body.issuer).toBe('string');
      expect(typeof body.authorization_endpoint).toBe('string');
      expect(typeof body.token_endpoint).toBe('string');
      expect(typeof body.registration_endpoint).toBe('string');
      expect(Array.isArray(body.response_types_supported)).toBe(true);
      expect(body.response_types_supported).toContain('code');
      expect(Array.isArray(body.grant_types_supported)).toBe(true);
      expect(body.grant_types_supported).toContain('authorization_code');
      expect(body.grant_types_supported).toContain('refresh_token');
      expect(Array.isArray(body.scopes_supported)).toBe(true);
      expect(body.scopes_supported).toContain('mcp:tools');
      expect(Array.isArray(body.code_challenge_methods_supported)).toBe(true);
      expect(body.code_challenge_methods_supported).toContain('S256');
    });

    it('exposes the JWKS endpoint for token verification', async () => {
      const res = await fetch(`${baseUrl}/auth/jwks`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { keys?: unknown };
      expect(Array.isArray(body.keys)).toBe(true);
    });
  });

  describe('RFC 7591: Dynamic Client Registration', () => {
    it('mints a public client and persists it', async () => {
      const res = await fetch(`${baseUrl}/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Conformance Test Client',
          redirect_uris: ['http://localhost:5173/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'openid mcp:tools',
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body.client_id).toBe('string');
      expect((body.client_id as string).length).toBeGreaterThan(8);
      expect(body.redirect_uris).toEqual(['http://localhost:5173/callback']);
    });
  });
});

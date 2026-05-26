import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.ts';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set DATABASE_URL or TEST_DATABASE_URL to a Postgres URL to run OAuth JWT resolver integration tests.';

(skipReason ? describe.skip : describe)('OAuth JWT resolver: end-to-end /mcp verification', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  let userId: string;
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let kid: string;

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'test-secret-do-not-use-in-prod-it-must-be-32-chars';
    process.env.MUNIN_KEY_PEPPER ??= 'test-pepper';
    process.env.MUNIN_EMBEDDING_PROVIDER = 'stub';
    process.env.MUNIN_MAIL_PROVIDER = 'stub';
    process.env.MUNIN_STORAGE_PROVIDER = 'local';
    process.env.MUNIN_STORAGE_LOCAL_PATH = '/tmp/munin-oauth-jwt-it';
    process.env.MUNIN_STORAGE_LOCAL_BASE_URL = 'http://127.0.0.1:0/static/assets';
    process.env.MUNIN_WEBHOOK_WORKER_DISABLED = '1';
    process.env.MUNIN_CMS_SCHEDULE_WORKER_DISABLED = '1';
    process.env.MUNIN_BUILTIN_AGENT = '0';

    await runMigrations(TEST_URL!);
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    process.env.DATABASE_URL = appUrl;

    db = createDb(TEST_URL!, { serviceRole: true });
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);

    const [org] = await db
      .insert(schema.orgs)
      .values({ name: 'JWT Resolver IT Org' })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `jwt-${randomUUID().slice(0, 8)}@test.example`, name: 'JWT IT User' })
      .returning();
    await db.insert(schema.orgMembers).values({
      orgId: org!.id,
      userId: user!.id,
      role: 'owner',
      isDefault: true,
    });
    userId = user!.id;

    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    kid = `jwk_${randomUUID().slice(0, 12)}`;
    await db.insert(schema.jwks).values({
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(await exportJWK(privateKey)),
    });
    signingKey = privateKey;

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

  async function sign(claims: {
    sub?: string;
    aud?: string | string[];
    iss?: string;
    scope?: string;
    expSeconds?: number;
  }): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({
      sub: claims.sub ?? userId,
      aud: claims.aud ?? `${baseUrl}/mcp`,
      scope: claims.scope ?? 'mcp:tools kb:read',
      azp: 'test-client',
      iat,
      exp: iat + (claims.expSeconds ?? 3600),
    })
      .setProtectedHeader({ alg: 'EdDSA', kid })
      .setIssuer(claims.iss ?? baseUrl);
    return jwt.sign(signingKey);
  }

  async function callMcp(token: string): Promise<{ status: number; wwwAuth: string | null }> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    return { status: res.status, wwwAuth: res.headers.get('www-authenticate') };
  }

  it('accepts a JWT signed by the in-DB JWKS with canonical audience', async () => {
    const token = await sign({});
    const { status, wwwAuth } = await callMcp(token);
    expect(status).not.toBe(401);
    expect(wwwAuth).toBeNull();
  });

  it('accepts a JWT whose audience drops the /mcp path (bare host with trailing slash — claude.ai shape)', async () => {
    const token = await sign({ aud: `${baseUrl}/` });
    const { status } = await callMcp(token);
    expect(status).not.toBe(401);
  });

  it('accepts a JWT whose audience is the bare origin without trailing slash', async () => {
    const token = await sign({ aud: baseUrl });
    const { status } = await callMcp(token);
    expect(status).not.toBe(401);
  });

  it('rejects a JWT with an audience pointing at a different host', async () => {
    const token = await sign({ aud: 'https://impostor.example.com/mcp' });
    const { status, wwwAuth } = await callMcp(token);
    expect(status).toBe(401);
    expect(wwwAuth).toContain('Bearer');
  });

  it('rejects a JWT signed with a key the JWKS table does not contain', async () => {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    const iat = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: userId,
      aud: `${baseUrl}/mcp`,
      scope: 'mcp:tools',
      iat,
      exp: iat + 3600,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'jwk_does_not_exist' })
      .setIssuer(baseUrl)
      .sign(privateKey);
    const { status } = await callMcp(token);
    expect(status).toBe(401);
  });

  it('rejects a JWT whose issuer does not match the canonical origin', async () => {
    const token = await sign({ iss: 'https://wrong-issuer.example.com' });
    const { status } = await callMcp(token);
    expect(status).toBe(401);
  });

  it('rejects an expired JWT', async () => {
    const token = await sign({ expSeconds: -60 });
    const { status } = await callMcp(token);
    expect(status).toBe(401);
  });

  it('rejects a JWT whose sub is not a known user (no org membership)', async () => {
    const token = await sign({ sub: 'usr_does_not_exist_xxxxxxxxxxxx' });
    const { status } = await callMcp(token);
    expect(status).toBe(401);
  });
});

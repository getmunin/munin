import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { z } from 'zod';
import { ActorIdentity, withContext, type RequestContext } from '@getmunin/core';
import { createDb, runMigrations, schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ConnectorRegistry,
  OAuthGrantRevokedError,
  requireAccessToken,
  type ConnectorAdapter,
  type ConnectorConnectionContext,
  type ConnectorOAuth,
  type ConnectorTestResult,
  type OAuthTokenSet,
} from './connector.ts';
import {
  ConnectorOAuthService,
  readStoredGrant,
  signAuthorizeState,
  verifyAuthorizeState,
} from './connector-oauth.service.ts';
import { ConnectorsService } from './connectors.service.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run connector oauth tests.';

interface VendorLog {
  exchanges: string[];
  refreshes: string[];
  revocations: string[];
}

const ConfigInput = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1).optional(),
});

class StubOAuthAdapter implements ConnectorAdapter {
  readonly vendor = 'stub_oauth';
  readonly domain = 'seo' as const;
  readonly displayName = 'Stub OAuth Vendor';
  readonly configInput = ConfigInput;
  readonly configFields = [
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client secret', required: true, secret: true },
  ];

  readonly oauth: ConnectorOAuth;

  constructor(
    readonly log: VendorLog,
    behavior: {
      exchange?: () => OAuthTokenSet;
      refresh?: () => OAuthTokenSet;
    } = {},
  ) {
    this.oauth = {
      authorizationScopes: ['https://stub.test/auth/read'],
      clientIdKey: 'clientId',
      encryptedClientSecretKey: 'encryptedClientSecret',
      authorizeUrl({ state, redirectUri, clientId }) {
        const url = new URL('https://stub.test/o/authorize');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('state', state);
        url.searchParams.set('access_type', 'offline');
        return url.toString();
      },
      exchangeCode({ code, client }) {
        log.exchanges.push(`${code}:${client.clientId}:${client.clientSecret}`);
        return Promise.resolve(
          behavior.exchange?.() ?? {
            accessToken: 'at_first',
            refreshToken: 'rt_first',
            expiresInSeconds: 3600,
          },
        );
      },
      refresh({ refreshToken, client }) {
        log.refreshes.push(`${refreshToken}:${client.clientSecret}`);
        const next = behavior.refresh?.() ?? {
          accessToken: 'at_second',
          expiresInSeconds: 3600,
        };
        return Promise.resolve(next);
      },
      revoke({ refreshToken }) {
        log.revocations.push(refreshToken);
        return Promise.resolve();
      },
    };
  }

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = ConfigInput.parse(input);
    const encryptedClientSecret = parsed.clientSecret
      ? await encryptSecret(parsed.clientSecret)
      : (previous?.encryptedClientSecret as string | undefined);
    if (!encryptedClientSecret) throw new Error('clientSecret required');
    return { clientId: parsed.clientId, encryptedClientSecret };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    return { clientId: stored.clientId };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const token = await requireAccessToken(ctx);
    return { ok: true, detail: `token ${token}` };
  }
}

(skipReason ? describe.skip : describe)('ConnectorOAuthService', () => {
  let db: ReturnType<typeof createDb>;
  let appDb: ReturnType<typeof createDb>;
  let orgId: string;
  let otherOrgId: string;
  let adminActor: ActorIdentity;

  beforeAll(async () => {
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    process.env.MUNIN_AUTH_SECRET ??= 'connector-oauth-test-secret-not-for-prod';
    await runMigrations(TEST_URL!);
    db = createDb(TEST_URL!, { serviceRole: true });
    const appUrl = TEST_URL!.replace(/(postgres(?:ql)?:\/\/)[^:@]+:[^@]+@/, '$1munin_app:munin_app@');
    appDb = createDb(appUrl);

    const [org] = await db.insert(schema.orgs).values({ name: 'OAuth Org' }).returning();
    orgId = org!.id;
    const [other] = await db.insert(schema.orgs).values({ name: 'OAuth Other Org' }).returning();
    otherOrgId = other!.id;
    adminActor = new ActorIdentity('admin_agent', 'agt_oauth_test', orgId, ['*'], ['admin']);
  });

  afterAll(async () => {
    if (db) {
      await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
      await db.delete(schema.orgs).where(sql`id in (${orgId}, ${otherOrgId})`);
    }
  });

  beforeEach(async () => {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    await db.execute(sql`DELETE FROM connector_connections WHERE org_id = ${orgId}`);
  });

  function harness(behavior: Parameters<typeof buildAdapter>[1] = {}) {
    const log: VendorLog = { exchanges: [], refreshes: [], revocations: [] };
    const adapter = buildAdapter(log, behavior);
    const registry = new ConnectorRegistry([adapter]);
    const oauth = new ConnectorOAuthService(registry, appDb);
    const connectors = new ConnectorsService(registry, undefined, appDb, oauth);
    return { log, adapter, oauth, connectors };
  }

  function buildAdapter(
    log: VendorLog,
    behavior: { exchange?: () => OAuthTokenSet; refresh?: () => OAuthTokenSet },
  ) {
    return new StubOAuthAdapter(log, behavior);
  }

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      const ctx: RequestContext = { db: tx, actor: adminActor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }

  async function createConnection(connectors: ConnectorsService) {
    return run(() =>
      connectors.createConnection({
        vendor: 'stub_oauth',
        name: 'Stub connection',
        config: { clientId: 'client-123', clientSecret: 'secret-abc' },
      }),
    );
  }

  async function connectionRow(id: string) {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db
      .select()
      .from(schema.connectorConnections)
      .where(sql`id = ${id}`)
      .limit(1);
    return rows[0]!;
  }

  async function accessTokenOf(oauth: ConnectorOAuthService, id: string): Promise<string> {
    return oauth.accessTokenFor(await connectionRow(id))();
  }

  async function readRow(id: string) {
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.execute<{
      config: Record<string, unknown>;
      credential_state: string;
      active: boolean;
      last_test_error: string | null;
    }>(
      sql`SELECT config, credential_state, active, last_test_error FROM connector_connections WHERE id = ${id}`,
    );
    return rows[0]!;
  }

  it('creates an OAuth connection pending and inactive even with its client secret in hand', async () => {
    const { connectors } = harness();

    const created = await createConnection(connectors);

    expect(created.credentialState).toBe('pending');
    expect(created.active).toBe(false);
    expect(created.needsAuthorization).toBe(true);
    expect(created.authorize?.url).toContain('client_id=client-123');
    expect(created.authorize?.url).toContain('access_type=offline');
  });

  it('signs authorize state so a tampered or stale one is refused', () => {
    const signed = signAuthorizeState({
      connectionId: 'cnc_1',
      orgId,
      exp: Date.now() + 60_000,
    });

    expect(verifyAuthorizeState(signed)).toMatchObject({ connectionId: 'cnc_1', orgId });
    expect(verifyAuthorizeState(`${signed}x`)).toBeNull();
    expect(verifyAuthorizeState('not-a-state')).toBeNull();
    expect(
      verifyAuthorizeState(signAuthorizeState({ connectionId: 'cnc_1', orgId, exp: Date.now() - 1 })),
    ).toBeNull();
  });

  it('exchanges the code with the decrypted client secret and activates the connection', async () => {
    const { connectors, oauth, log } = harness();
    const created = await createConnection(connectors);
    const state = signAuthorizeState({
      connectionId: created.id,
      orgId,
      exp: Date.now() + 60_000,
    });

    await oauth.completeAuthorization({ code: 'auth-code-1', state });

    expect(log.exchanges).toEqual(['auth-code-1:client-123:secret-abc']);
    const row = await readRow(created.id);
    expect(row.credential_state).toBe('active');
    expect(row.active).toBe(true);
    const grant = readStoredGrant(row.config)!;
    expect(grant.scopes).toEqual(['https://stub.test/auth/read']);
    expect(JSON.stringify(row.config)).not.toContain('rt_first');
    expect(JSON.stringify(row.config)).not.toContain('at_first');
  });

  it('refuses a grant that comes back without a refresh token', async () => {
    const { connectors, oauth } = harness({
      exchange: () => ({ accessToken: 'at_only', expiresInSeconds: 3600 }),
    });
    const created = await createConnection(connectors);
    const state = signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 });

    await expect(oauth.completeAuthorization({ code: 'c', state })).rejects.toThrow(
      /no refresh token/,
    );
  });

  it('will not let one org complete another org’s connection', async () => {
    const { connectors, oauth } = harness();
    const created = await createConnection(connectors);
    const state = signAuthorizeState({
      connectionId: created.id,
      orgId: otherOrgId,
      exp: Date.now() + 60_000,
    });

    await expect(oauth.completeAuthorization({ code: 'c', state })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reuses a live access token without going back to the vendor', async () => {
    const { connectors, oauth, log } = harness();
    const created = await createConnection(connectors);
    await oauth.completeAuthorization({
      code: 'c',
      state: signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 }),
    });

    const row = await readRow(created.id);
    const token = await accessTokenOf(oauth, created.id);

    expect(token).toBe('at_first');
    expect(log.refreshes).toEqual([]);
    expect(row.credential_state).toBe('active');
  });

  it('refreshes an expired access token and persists the replacement', async () => {
    const { connectors, oauth, log } = harness({
      exchange: () => ({
        accessToken: 'at_first',
        refreshToken: 'rt_first',
        expiresInSeconds: -10,
      }),
    });
    const created = await createConnection(connectors);
    await oauth.completeAuthorization({
      code: 'c',
      state: signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 }),
    });

    const token = await accessTokenOf(oauth, created.id);

    expect(token).toBe('at_second');
    expect(log.refreshes).toEqual(['rt_first:secret-abc']);
    const grant = readStoredGrant((await readRow(created.id)).config)!;
    expect(grant.accessTokenExpiresAt).not.toBeNull();
    expect(Date.parse(grant.accessTokenExpiresAt!)).toBeGreaterThan(Date.now());
  });

  it('keeps the previous refresh token when the vendor rotates only the access token', async () => {
    const { connectors, oauth } = harness({
      exchange: () => ({ accessToken: 'at_first', refreshToken: 'rt_first', expiresInSeconds: -10 }),
    });
    const created = await createConnection(connectors);
    await oauth.completeAuthorization({
      code: 'c',
      state: signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 }),
    });
    const before = readStoredGrant((await readRow(created.id)).config)!;

    await accessTokenOf(oauth, created.id);

    const after = readStoredGrant((await readRow(created.id)).config)!;
    expect(after.encryptedRefreshToken).toBe(before.encryptedRefreshToken);
  });

  it('refreshes once when several calls race for the same connection', async () => {
    const { connectors, oauth, log } = harness({
      exchange: () => ({ accessToken: 'at_first', refreshToken: 'rt_first', expiresInSeconds: -10 }),
    });
    const created = await createConnection(connectors);
    await oauth.completeAuthorization({
      code: 'c',
      state: signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 }),
    });

    const accessToken = oauth.accessTokenFor(await connectionRow(created.id));
    const tokens = await Promise.all([accessToken(), accessToken(), accessToken()]);

    expect(tokens).toEqual(['at_second', 'at_second', 'at_second']);
    expect(log.refreshes).toHaveLength(1);
  });

  it('marks the connection expired when the vendor has dropped the grant', async () => {
    const { connectors, oauth } = harness({
      exchange: () => ({ accessToken: 'at_first', refreshToken: 'rt_first', expiresInSeconds: -10 }),
      refresh: () => {
        throw new OAuthGrantRevokedError('invalid_grant');
      },
    });
    const created = await createConnection(connectors);
    await oauth.completeAuthorization({
      code: 'c',
      state: signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 }),
    });

    const err = await accessTokenOf(oauth, created.id).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('connectors_expired');
    const row = await readRow(created.id);
    expect(row.credential_state).toBe('expired');
    expect(row.active).toBe(false);
    expect(row.last_test_error).toBe('invalid_grant');
  });

  it('names the unusable connection instead of claiming none is configured', async () => {
    const { connectors } = harness();
    await createConnection(connectors);

    const err = await run(() => connectors.resolveScope('seo')).catch((e: unknown) => e);

    expect((err as Error).message).toContain('Stub connection (pending)');
  });

  it('revokes the grant at the vendor and clears the stored tokens on delete', async () => {
    const { connectors, oauth, log } = harness();
    const created = await createConnection(connectors);
    await oauth.completeAuthorization({
      code: 'c',
      state: signAuthorizeState({ connectionId: created.id, orgId, exp: Date.now() + 60_000 }),
    });

    await run(() => connectors.deleteConnection({ connectionId: created.id }));

    expect(log.revocations).toEqual(['rt_first']);
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const rows = await db.execute(
      sql`SELECT id FROM connector_connections WHERE id = ${created.id}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps an OAuth connection pending after its client secret arrives by credential link', async () => {
    const { connectors } = harness();
    const created = await createConnection(connectors);

    const result = await run(() =>
      connectors.applyCredentials(created.id, { clientSecret: 'secret-rotated' }),
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('connectors_get_authorize_url');
    const row = await readRow(created.id);
    expect(row.credential_state).toBe('pending');
    expect(row.active).toBe(false);
  });

  it('refuses an authorize link for a vendor that uses static credentials', async () => {
    const { connectors } = harness();
    await db.execute(sql`SELECT set_config('app.bypass_rls', 'on', false)`);
    const [row] = await db
      .insert(schema.connectorConnections)
      .values({
        orgId,
        vendor: 'stub_oauth',
        domain: 'seo',
        name: 'Manual row',
        config: {},
      })
      .returning();

    await expect(run(() => connectors.authorizeUrl({ connectionId: row!.id }))).rejects.toThrow(
      /needs clientId/,
    );
  });
});

import 'reflect-metadata';
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, makeId, runMigrations, schema } from '@getmunin/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { OutboundOAuthStore } from '../../common/outbound-oauth/grant-store.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { SocialAccountsService } from './social-accounts.service.ts';
import {
  SocialGrantRevokedError,
  SocialOAuthRegistry,
  type SocialAuthorTarget,
  type SocialOAuthAdapter,
  type SocialTokenSet,
} from './social-oauth.ts';
import type { SocialAuthorKind, SocialPlatform } from './social-platform.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_URL
  ? null
  : 'Set TEST_DATABASE_URL to a Postgres URL to run social account tests.';

const SIXTY_DAYS = 60 * 24 * 60 * 60;

class FakeLinkedIn implements SocialOAuthAdapter {
  readonly platform: SocialPlatform = 'linkedin';
  readonly displayName = 'LinkedIn';
  readonly authorizationScopes = ['w_member_social'];

  next: SocialTokenSet = { accessToken: 'access-1', expiresInSeconds: SIXTY_DAYS };
  identity = { externalAccountId: 'member-1', displayName: 'Ola Nordmann' };
  refreshCalls = 0;
  refreshOutcome: 'ok' | 'revoked' = 'ok';

  authorizeUrl(args: { state: string; redirectUri: string; clientId: string }): string {
    return `https://linkedin.example/authorize?state=${args.state}&client_id=${args.clientId}`;
  }

  exchangeCode(): Promise<SocialTokenSet> {
    return Promise.resolve(this.next);
  }

  refresh(): Promise<SocialTokenSet> {
    this.refreshCalls += 1;
    if (this.refreshOutcome === 'revoked') {
      return Promise.reject(new SocialGrantRevokedError('invalid_grant'));
    }
    return Promise.resolve({ accessToken: 'access-2', expiresInSeconds: SIXTY_DAYS });
  }

  identify(): Promise<{ externalAccountId: string; displayName: string | null }> {
    return Promise.resolve(this.identity);
  }
}

class FakeFacebook implements SocialOAuthAdapter {
  readonly platform: SocialPlatform = 'facebook';
  readonly displayName = 'Facebook';
  readonly authorizationScopes = ['pages_manage_posts'];
  readonly authorKind: SocialAuthorKind = 'org_page';
  readonly accessTokenNeverExpires = true;

  targets: SocialAuthorTarget[] = [
    { externalAccountId: 'page-1', displayName: 'Acme', accessToken: 'page-token-1' },
    { externalAccountId: 'page-2', displayName: 'Globex', accessToken: 'page-token-2' },
  ];

  authorizeUrl(args: { state: string }): string {
    return `https://facebook.example.test/dialog/oauth?state=${args.state}`;
  }

  exchangeCode(): Promise<SocialTokenSet> {
    return Promise.resolve({ accessToken: 'owner-token', expiresInSeconds: SIXTY_DAYS });
  }

  refresh(): Promise<SocialTokenSet> {
    return Promise.reject(new SocialGrantRevokedError('a Page token cannot be renewed'));
  }

  listTargets(): Promise<SocialAuthorTarget[]> {
    return Promise.resolve(this.targets);
  }
}

(skipReason ? describe.skip : describe)('SocialAccountsService', () => {
  let svcDb: ReturnType<typeof createDb>;
  let orgId: string;
  let ola: string;
  let kari: string;

  const adapter = new FakeLinkedIn();
  const facebook = new FakeFacebook();
  const registry = new SocialOAuthRegistry();
  let service: SocialAccountsService;
  let store: OutboundOAuthStore;

  async function asOrg<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const actor = new ActorIdentity(
      'user',
      userId,
      orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    return await svcDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return await withContext(ctx, fn);
    });
  }

  beforeAll(async () => {
    process.env.MUNIN_AUTH_SECRET ??= 'integration-secret';
    process.env.MUNIN_ENCRYPTION_KEY ??= 'integration-test-encryption-key';
    await runMigrations(TEST_URL!);
    svcDb = createDb(TEST_URL!);
    store = new OutboundOAuthStore(svcDb);
    registry.register(adapter);
    registry.register(facebook);
    service = new SocialAccountsService(registry, store, new AlertsService(new WebhookDispatcher()));

    orgId = makeId('org');
    ola = makeId('usr');
    kari = makeId('usr');
    await svcDb.insert(schema.orgs).values({ id: orgId, name: 'Acme' });
    await svcDb.insert(schema.users).values([
      { id: ola, email: `ola-${ola}@example.test`, name: 'Ola Nordmann' },
      { id: kari, email: `kari-${kari}@example.test`, name: 'Kari Nordmann' },
    ]);
  });

  afterAll(async () => {
    if (!svcDb) return;
    await svcDb.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await svcDb.delete(schema.users).where(inArray(schema.users.id, [ola, kari]));
  });

  beforeEach(async () => {
    await svcDb.delete(schema.socialAccounts).where(eq(schema.socialAccounts.orgId, orgId));
    await svcDb.delete(schema.orgAlerts).where(eq(schema.orgAlerts.orgId, orgId));
    await svcDb.delete(schema.socialPlatformApps).where(eq(schema.socialPlatformApps.orgId, orgId));
    adapter.next = { accessToken: 'access-1', expiresInSeconds: SIXTY_DAYS };
    adapter.identity = { externalAccountId: 'member-1', displayName: 'Ola Nordmann' };
    adapter.refreshCalls = 0;
    adapter.refreshOutcome = 'ok';
    await asOrg(ola, async () => {
      await service.setPlatformApp({
        platform: 'linkedin',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      });
    });
  });

  async function connect(userId: string): Promise<string> {
    const { url } = await asOrg(userId, () => service.authorizeUrl({ platform: 'linkedin' }));
    const state = new URL(url).searchParams.get('state')!;
    const result = await service.completeAuthorization({ code: 'code', state });
    return result.accountId!;
  }

  it('stores a grant that has no refresh token, which is all a self-serve LinkedIn app returns', async () => {
    const accountId = await connect(ola);
    const [row] = await svcDb
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, accountId));
    expect(row!.encryptedRefreshToken).toBeNull();
    expect(row!.status).toBe('active');
    expect(row!.accessTokenExpiresAt).not.toBeNull();

    const token = await service.accessTokenFor({ orgId, userId: ola, platform: 'linkedin' });
    expect(token).toBe('access-1');
  });

  it('never returns the client secret or a token through a read surface', async () => {
    await connect(ola);
    const [dto] = await asOrg(ola, () => service.listAccounts());
    expect(JSON.stringify(dto)).not.toContain('client-secret');
    expect(JSON.stringify(dto)).not.toContain('access-1');
    expect(dto!.canRefresh).toBe(false);

    const [app] = await asOrg(ola, () => service.listPlatformApps());
    expect(JSON.stringify(app)).not.toContain('client-secret');
    expect(app!.configured).toBe(true);
  });

  it('asks the person to reconnect when the grant lapsed and nothing can renew it', async () => {
    const accountId = await connect(ola);
    await svcDb
      .update(schema.socialAccounts)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.socialAccounts.id, accountId));

    await expect(
      service.accessTokenFor({ orgId, userId: ola, platform: 'linkedin' }),
    ).rejects.toThrow(/social_reconnect_required/);
    expect(adapter.refreshCalls).toBe(0);
  });

  it('commits the expired marker even though the caller is handed an error', async () => {
    const accountId = await connect(ola);
    await svcDb
      .update(schema.socialAccounts)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.socialAccounts.id, accountId));
    await service
      .accessTokenFor({ orgId, userId: ola, platform: 'linkedin' })
      .catch(() => undefined);

    const [row] = await svcDb
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, accountId));
    expect(row!.status).toBe('expired');
    expect(row!.lastError).toMatch(/no refresh token/);
  });

  it('raises the alert against the person who must act, not the whole org', async () => {
    const accountId = await connect(ola);
    await svcDb
      .update(schema.socialAccounts)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.socialAccounts.id, accountId));
    await service
      .accessTokenFor({ orgId, userId: ola, platform: 'linkedin' })
      .catch(() => undefined);

    const alerts = await svcDb
      .select()
      .from(schema.orgAlerts)
      .where(and(eq(schema.orgAlerts.orgId, orgId), eq(schema.orgAlerts.source, 'social')));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.userId).toBe(ola);
    expect(alerts[0]!.severity).toBe('error');
  });

  it('renews silently when a refresh token is present, so a partner app never nags', async () => {
    const accountId = await connect(ola);
    await svcDb
      .update(schema.socialAccounts)
      .set({
        encryptedRefreshToken: (
          await store.inRootTransaction((tx) => store.encrypt(tx, 'refresh-1'))
        ),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(schema.socialAccounts.id, accountId));

    const token = await service.accessTokenFor({ orgId, userId: ola, platform: 'linkedin' });
    expect(token).toBe('access-2');
    expect(adapter.refreshCalls).toBe(1);

    const alerts = await svcDb
      .select()
      .from(schema.orgAlerts)
      .where(eq(schema.orgAlerts.orgId, orgId));
    expect(alerts).toHaveLength(0);
  });

  it('treats a revoked refresh token as a reconnection, not a crash', async () => {
    const accountId = await connect(ola);
    adapter.refreshOutcome = 'revoked';
    await svcDb
      .update(schema.socialAccounts)
      .set({
        encryptedRefreshToken: (
          await store.inRootTransaction((tx) => store.encrypt(tx, 'refresh-1'))
        ),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(schema.socialAccounts.id, accountId));

    await expect(
      service.accessTokenFor({ orgId, userId: ola, platform: 'linkedin' }),
    ).rejects.toThrow(/social_reconnect_required/);
    const [row] = await svcDb
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, accountId));
    expect(row!.status).toBe('expired');
  });

  it('refuses to let a colleague claim a LinkedIn account someone else already connected', async () => {
    await connect(ola);
    const { url } = await asOrg(kari, () => service.authorizeUrl({ platform: 'linkedin' }));
    const state = new URL(url).searchParams.get('state')!;
    await expect(service.completeAuthorization({ code: 'code', state })).rejects.toThrow(
      /social_account_taken/,
    );
  });

  it('clears the reconnect alert once the person authorizes again', async () => {
    const accountId = await connect(ola);
    await svcDb
      .update(schema.socialAccounts)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.socialAccounts.id, accountId));
    await service
      .accessTokenFor({ orgId, userId: ola, platform: 'linkedin' })
      .catch(() => undefined);

    await connect(ola);

    const open = await svcDb
      .select()
      .from(schema.orgAlerts)
      .where(
        and(
          eq(schema.orgAlerts.orgId, orgId),
          eq(schema.orgAlerts.source, 'social'),
          sql`${schema.orgAlerts.resolvedAt} IS NULL`,
        ),
      );
    expect(open).toHaveLength(0);
  });

  it('keeps the stored client secret when only the client id is edited', async () => {
    await asOrg(ola, () =>
      service.setPlatformApp({ platform: 'linkedin', clientId: 'client-id-2' }),
    );

    const [row] = await svcDb
      .select()
      .from(schema.socialPlatformApps)
      .where(eq(schema.socialPlatformApps.orgId, orgId));
    expect(row!.clientId).toBe('client-id-2');

    const accountId = await connect(ola);
    expect(accountId).toBeTruthy();
  });

  it('replaces the stored secret when a new one is given', async () => {
    const [before] = await svcDb
      .select()
      .from(schema.socialPlatformApps)
      .where(eq(schema.socialPlatformApps.orgId, orgId));

    await asOrg(ola, () =>
      service.setPlatformApp({
        platform: 'linkedin',
        clientId: 'client-id',
        clientSecret: 'client-secret-2',
      }),
    );

    const [after] = await svcDb
      .select()
      .from(schema.socialPlatformApps)
      .where(eq(schema.socialPlatformApps.orgId, orgId));
    expect(after!.encryptedClientSecret).not.toBe(before!.encryptedClientSecret);
  });

  it('refuses a first save with no secret, because there is none stored to keep', async () => {
    await svcDb.delete(schema.socialPlatformApps).where(eq(schema.socialPlatformApps.orgId, orgId));
    await expect(
      asOrg(ola, () => service.setPlatformApp({ platform: 'linkedin', clientId: 'client-id' })),
    ).rejects.toMatchObject({ response: { code: 'social_client_secret_required' } });
  });

  it('refuses to mint an authorize url before the org has entered its OAuth client', async () => {
    await svcDb.delete(schema.socialPlatformApps).where(eq(schema.socialPlatformApps.orgId, orgId));
    await expect(asOrg(ola, () => service.authorizeUrl({ platform: 'linkedin' }))).rejects.toThrow(
      /social_app_missing/,
    );
  });

  describe('a platform where the person chooses which page to post as', () => {
    beforeEach(async () => {
      await svcDb
        .delete(schema.socialPendingGrants)
        .where(eq(schema.socialPendingGrants.orgId, orgId));
      facebook.targets = [
        { externalAccountId: 'page-1', displayName: 'Acme', accessToken: 'page-token-1' },
        { externalAccountId: 'page-2', displayName: 'Globex', accessToken: 'page-token-2' },
      ];
      await asOrg(ola, () =>
        service.setPlatformApp({
          platform: 'facebook',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
      );
    });

    async function authorize(userId: string): Promise<string> {
      const { url } = await asOrg(userId, () => service.authorizeUrl({ platform: 'facebook' }));
      const state = new URL(url).searchParams.get('state')!;
      const result = await service.completeAuthorization({ code: 'code', state });
      return result.pendingId!;
    }

    it('parks the grant instead of writing an account, because no page is chosen yet', async () => {
      const pendingId = await authorize(ola);
      expect(pendingId).toBeTruthy();

      const accounts = await svcDb
        .select()
        .from(schema.socialAccounts)
        .where(
          and(eq(schema.socialAccounts.orgId, orgId), eq(schema.socialAccounts.platform, 'facebook')),
        );
      expect(accounts).toHaveLength(0);

      const [parked] = await svcDb
        .select()
        .from(schema.socialPendingGrants)
        .where(eq(schema.socialPendingGrants.id, pendingId));
      expect(parked!.encryptedOwnerToken).not.toContain('owner-token');
    });

    it('offers the pages to choose from without handing out their tokens', async () => {
      const pendingId = await authorize(ola);
      const offered = await asOrg(ola, () => service.listPendingTargets(pendingId));

      expect(offered.platform).toBe('facebook');
      expect(offered.targets).toEqual([
        { externalAccountId: 'page-1', displayName: 'Acme' },
        { externalAccountId: 'page-2', displayName: 'Globex' },
      ]);
      expect(JSON.stringify(offered)).not.toContain('page-token');
    });

    it('binds the chosen page, storing its own token with no expiry to sweep', async () => {
      const pendingId = await authorize(ola);
      const account = await asOrg(ola, () =>
        service.selectTarget({ pendingId, externalAccountId: 'page-2' }),
      );

      expect(account.authorKind).toBe('org_page');
      expect(account.externalAccountId).toBe('page-2');
      expect(account.displayName).toBe('Globex');
      expect(account.accessTokenExpiresAt).toBeNull();
      expect(account.expiresSoon).toBe(false);

      const [row] = await svcDb
        .select()
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.id, account.id));
      expect(row!.encryptedRefreshToken).toBeNull();
      expect(row!.accessTokenExpiresAt).toBeNull();

      const parked = await svcDb
        .select()
        .from(schema.socialPendingGrants)
        .where(eq(schema.socialPendingGrants.id, pendingId));
      expect(parked).toHaveLength(0);
    });

    it('publishes with a page token that never expires, rather than trying to renew it', async () => {
      const pendingId = await authorize(ola);
      await asOrg(ola, () => service.selectTarget({ pendingId, externalAccountId: 'page-1' }));

      const token = await service.accessTokenFor({ orgId, userId: ola, platform: 'facebook' });
      expect(token).toBe('page-token-1');
    });

    it('lets two colleagues post as the same page, which a shared company page is for', async () => {
      const first = await authorize(ola);
      await asOrg(ola, () => service.selectTarget({ pendingId: first, externalAccountId: 'page-1' }));
      const second = await authorize(kari);
      const account = await asOrg(kari, () =>
        service.selectTarget({ pendingId: second, externalAccountId: 'page-1' }),
      );

      expect(account.userId).toBe(kari);
      expect(account.externalAccountId).toBe('page-1');
    });

    it('refuses a page the person can no longer post to, rather than storing a stale token', async () => {
      const pendingId = await authorize(ola);
      facebook.targets = facebook.targets.filter((t) => t.externalAccountId !== 'page-2');
      await expect(
        asOrg(ola, () => service.selectTarget({ pendingId, externalAccountId: 'page-2' })),
      ).rejects.toMatchObject({ response: { code: 'social_target_unavailable' } });
    });

    it('reports an account that administers no page it may post to', async () => {
      const pendingId = await authorize(ola);
      facebook.targets = [];
      await expect(
        asOrg(ola, () => service.listPendingTargets(pendingId)),
      ).rejects.toMatchObject({ response: { code: 'social_no_targets' } });
    });

    it('will not let a colleague spend an authorization that is not theirs', async () => {
      const pendingId = await authorize(ola);
      await expect(
        asOrg(kari, () => service.selectTarget({ pendingId, externalAccountId: 'page-1' })),
      ).rejects.toMatchObject({ response: { code: 'social_authorization_expired' } });
    });

    it('closes an authorization the person left open too long', async () => {
      const pendingId = await authorize(ola);
      await svcDb
        .update(schema.socialPendingGrants)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.socialPendingGrants.id, pendingId));

      await expect(
        asOrg(ola, () => service.listPendingTargets(pendingId)),
      ).rejects.toMatchObject({ response: { code: 'social_authorization_expired' } });

      expect(await service.purgeExpiredPendingGrants()).toBeGreaterThan(0);
      const left = await svcDb
        .select()
        .from(schema.socialPendingGrants)
        .where(eq(schema.socialPendingGrants.id, pendingId));
      expect(left).toHaveLength(0);
    });

    it('keeps one authorization in flight per person, so a restart replaces the parked token', async () => {
      const first = await authorize(ola);
      const second = await authorize(ola);
      expect(second).not.toBe(first);

      const parked = await svcDb
        .select()
        .from(schema.socialPendingGrants)
        .where(
          and(
            eq(schema.socialPendingGrants.orgId, orgId),
            eq(schema.socialPendingGrants.userId, ola),
          ),
        );
      expect(parked.map((p) => p.id)).toEqual([second]);
    });
  });
});

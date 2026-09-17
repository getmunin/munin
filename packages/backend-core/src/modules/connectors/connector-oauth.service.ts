import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, type Tx } from '@getmunin/db';
import { authorizationServerUrl } from '../../oauth/oauth.constants.ts';
import {
  OutboundOAuthStore,
  type RefreshOutcome,
} from '../../common/outbound-oauth/grant-store.ts';
import {
  accessTokenIsFresh,
  nextGrant,
  readGrant,
  type StoredOAuthGrant,
} from '../../common/outbound-oauth/grant.ts';
import { readSignedState, signSignedState } from '../../common/outbound-oauth/signed-state.ts';
import { SingleFlight } from '../../common/outbound-oauth/single-flight.ts';
import {
  ConnectorRegistry,
  OAuthGrantRevokedError,
  type ConnectorAdapter,
  type ConnectorOAuth,
  type OAuthClientCredentials,
  type OAuthTokenSet,
} from './connector.ts';

export const OAUTH_CONFIG_KEY = 'oauth';
const AUTHORIZE_STATE_TTL_MS = 10 * 60 * 1000;

export type { StoredOAuthGrant } from '../../common/outbound-oauth/grant.ts';

interface AuthorizeState {
  connectionId: string;
  orgId: string;
  exp: number;
}

type ConnectionRow = typeof schema.connectorConnections.$inferSelect;

export function connectorOAuthRedirectUri(): string {
  return `${authorizationServerUrl()}/v1/connectors/oauth/callback`;
}

function stateSecret(): string {
  const secret = process.env.MUNIN_AUTH_SECRET;
  if (!secret) {
    throw new BadRequestException(
      'connectors_invalid: MUNIN_AUTH_SECRET must be set to run an OAuth connector flow',
    );
  }
  return secret;
}

export function signAuthorizeState(state: AuthorizeState): string {
  return signSignedState(state, stateSecret());
}

export function verifyAuthorizeState(raw: unknown): AuthorizeState | null {
  const state = readSignedState(raw, stateSecret());
  if (!state) return null;
  const connectionId = state['connectionId'];
  const orgId = state['orgId'];
  const exp = state['exp'];
  if (typeof connectionId !== 'string' || typeof orgId !== 'string') return null;
  if (typeof exp !== 'number') return null;
  return { connectionId, orgId, exp };
}

export function readStoredGrant(config: Record<string, unknown>): StoredOAuthGrant | null {
  return readGrant(config[OAUTH_CONFIG_KEY]);
}

@Injectable()
export class ConnectorOAuthService {
  private readonly inFlight = new SingleFlight<string>();

  constructor(
    @Inject(ConnectorRegistry) private readonly registry: ConnectorRegistry,
    @Inject(OutboundOAuthStore) private readonly store: OutboundOAuthStore,
  ) {}

  isOAuthVendor(vendor: string): boolean {
    return !!this.registry.get(vendor)?.oauth;
  }

  authorizeUrl(row: ConnectionRow): { url: string; expiresAt: string } {
    const { adapter, oauth } = this.requireOAuthAdapter(row.vendor);
    const clientId = row.config[oauth.clientIdKey];
    if (typeof clientId !== 'string' || clientId.length === 0) {
      throw new BadRequestException(
        `connectors_invalid: ${adapter.displayName} needs ${oauth.clientIdKey} before it can be authorized`,
      );
    }
    const exp = Date.now() + AUTHORIZE_STATE_TTL_MS;
    const state = signAuthorizeState({ connectionId: row.id, orgId: row.orgId, exp });
    return {
      url: oauth.authorizeUrl({ state, redirectUri: connectorOAuthRedirectUri(), clientId }),
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async completeAuthorization(args: {
    code: string;
    state: string;
  }): Promise<{ orgId: string; connectionId: string; vendor: string }> {
    const state = verifyAuthorizeState(args.state);
    if (!state) throw new BadRequestException('connectors_invalid_state');
    return this.withConnection(state.connectionId, state.orgId, async (tx, row) => {
      const { adapter, oauth } = this.requireOAuthAdapter(row.vendor);
      const client = await this.decryptClient(tx, row.config, oauth, adapter);
      let tokens: OAuthTokenSet;
      try {
        tokens = await oauth.exchangeCode({
          code: args.code,
          redirectUri: connectorOAuthRedirectUri(),
          client,
        });
      } catch (err) {
        throw new BadRequestException(
          `connectors_invalid: ${adapter.displayName} rejected the authorization code${
            err instanceof Error ? `: ${err.message}` : ''
          }`,
        );
      }
      if (!tokens.refreshToken) {
        throw new BadRequestException(
          `connectors_invalid: ${adapter.displayName} returned no refresh token; the grant must be requested with offline access`,
        );
      }
      const grant = await this.buildGrant(tx, tokens, oauth, null);
      await tx
        .update(schema.connectorConnections)
        .set({
          config: { ...row.config, [OAUTH_CONFIG_KEY]: grant },
          credentialState: 'active',
          active: true,
          lastTestError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.connectorConnections.id, row.id));
      return { orgId: row.orgId, connectionId: row.id, vendor: row.vendor };
    });
  }

  accessTokenFor(row: ConnectionRow): () => Promise<string> {
    return () => this.inFlight.run(row.id, () => this.resolveAccessToken(row));
  }

  async revoke(row: ConnectionRow): Promise<void> {
    const adapter = this.registry.get(row.vendor);
    if (!adapter?.oauth) return;
    const oauth = adapter.oauth;
    await this.withConnection(row.id, row.orgId, async (tx, current) => {
      const grant = readStoredGrant(current.config);
      if (!grant) return;
      const client = await this.decryptClient(tx, current.config, oauth, adapter);
      const refreshToken = await this.store.decrypt(tx, grant.encryptedRefreshToken);
      await oauth.revoke({ refreshToken, client }).catch(() => undefined);
      const rest = { ...current.config };
      delete rest[OAUTH_CONFIG_KEY];
      await tx
        .update(schema.connectorConnections)
        .set({
          config: rest,
          credentialState: 'revoked',
          active: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.connectorConnections.id, current.id));
    });
  }

  private async resolveAccessToken(row: ConnectionRow): Promise<string> {
    return this.store.resolveOrMarkRevoked({
      attempt: () => this.refreshUnderLock(row),
      onRevoked: (reason) => this.markExpired(row, reason),
      revokedError: (reason) =>
        new BadRequestException(
          `connectors_expired: ${this.displayNameOf(row.vendor)} no longer accepts this connection's grant (${reason}) — reconnect it with connectors_get_authorize_url`,
        ),
    });
  }

  private displayNameOf(vendor: string): string {
    return this.registry.get(vendor)?.displayName ?? vendor;
  }

  private async markExpired(row: ConnectionRow, reason: string): Promise<void> {
    await this.withConnection(row.id, row.orgId, async (tx, current) => {
      await tx
        .update(schema.connectorConnections)
        .set({
          credentialState: 'expired',
          active: false,
          lastTestError: reason,
          updatedAt: new Date(),
        })
        .where(eq(schema.connectorConnections.id, current.id));
    });
  }

  private async refreshUnderLock(row: ConnectionRow): Promise<RefreshOutcome<string>> {
    return this.withConnection(row.id, row.orgId, async (tx, current) => {
      const { adapter, oauth } = this.requireOAuthAdapter(current.vendor);
      const grant = readStoredGrant(current.config);
      if (!grant) {
        throw new BadRequestException(
          `connectors_invalid: connection ${current.name} has not been authorized yet — open the link from connectors_get_authorize_url`,
        );
      }
      if (grant.encryptedAccessToken && accessTokenIsFresh(grant)) {
        return { token: await this.store.decrypt(tx, grant.encryptedAccessToken) };
      }
      const client = await this.decryptClient(tx, current.config, oauth, adapter);
      const refreshToken = await this.store.decrypt(tx, grant.encryptedRefreshToken);
      let tokens: OAuthTokenSet;
      try {
        tokens = await oauth.refresh({ refreshToken, client });
      } catch (err) {
        if (err instanceof OAuthGrantRevokedError) return { revoked: err.message };
        throw err;
      }
      const next = await this.buildGrant(tx, tokens, oauth, grant);
      await tx
        .update(schema.connectorConnections)
        .set({
          config: { ...current.config, [OAUTH_CONFIG_KEY]: next },
          lastTestError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.connectorConnections.id, current.id));
      return { token: tokens.accessToken };
    });
  }

  private async buildGrant(
    tx: Tx,
    tokens: OAuthTokenSet,
    oauth: ConnectorOAuth,
    previous: StoredOAuthGrant | null,
  ): Promise<StoredOAuthGrant> {
    return nextGrant({
      encryptedAccessToken: await this.store.encrypt(tx, tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? await this.store.encrypt(tx, tokens.refreshToken)
        : null,
      expiresInSeconds: tokens.expiresInSeconds,
      scopes: oauth.authorizationScopes,
      previous,
    });
  }

  private requireOAuthAdapter(vendor: string): {
    adapter: ConnectorAdapter;
    oauth: ConnectorOAuth;
  } {
    const adapter = this.registry.get(vendor);
    if (!adapter) {
      throw new BadRequestException(`connectors_invalid: unknown vendor ${vendor}`);
    }
    if (!adapter.oauth) {
      throw new BadRequestException(
        `connectors_invalid: ${adapter.displayName} uses static credentials, not OAuth`,
      );
    }
    return { adapter, oauth: adapter.oauth };
  }

  private async decryptClient(
    tx: Tx,
    config: Record<string, unknown>,
    oauth: ConnectorOAuth,
    adapter: ConnectorAdapter,
  ): Promise<OAuthClientCredentials> {
    const clientId = config[oauth.clientIdKey];
    const encryptedSecret = config[oauth.encryptedClientSecretKey];
    if (typeof clientId !== 'string' || typeof encryptedSecret !== 'string') {
      throw new BadRequestException(
        `connectors_invalid: ${adapter.displayName} is missing its OAuth client credentials — enter them through the credential link first`,
      );
    }
    return { clientId, clientSecret: await this.store.decrypt(tx, encryptedSecret) };
  }

  private async withConnection<T>(
    connectionId: string,
    expectedOrgId: string,
    fn: (tx: Tx, row: ConnectionRow) => Promise<T>,
  ): Promise<T> {
    return this.store.inRootTransaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.connectorConnections)
        .where(eq(schema.connectorConnections.id, connectionId))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (!row || row.orgId !== expectedOrgId) {
        throw new NotFoundException(`connectors_not_found: connection ${connectionId} not found`);
      }
      return fn(tx, row);
    });
  }
}

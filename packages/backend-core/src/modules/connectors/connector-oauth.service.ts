import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  decryptSecretSql,
  encryptSecretSql,
  setEncryptionKeySql,
  signHmac,
  verifyHmac,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { authorizationServerUrl } from '../../oauth/oauth.constants.ts';
import {
  ConnectorRegistry,
  OAuthGrantRevokedError,
  type ConnectorAdapter,
  type ConnectorOAuth,
  type OAuthClientCredentials,
  type OAuthTokenSet,
} from './connector.ts';
import { ConnectorVendorError } from './http.ts';

export const OAUTH_CONFIG_KEY = 'oauth';
const AUTHORIZE_STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 60_000;

export interface StoredOAuthGrant {
  encryptedRefreshToken: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: string | null;
  scopes: string[];
  connectedAt: string;
}

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
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${signHmac(payload, stateSecret())}`;
}

export function verifyAuthorizeState(raw: unknown): AuthorizeState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  if (!verifyHmac(payload, stateSecret(), raw.slice(dot + 1))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const state = parsed as Partial<AuthorizeState>;
  if (typeof state.connectionId !== 'string' || typeof state.orgId !== 'string') return null;
  if (typeof state.exp !== 'number' || state.exp < Date.now()) return null;
  return { connectionId: state.connectionId, orgId: state.orgId, exp: state.exp };
}

export function readStoredGrant(config: Record<string, unknown>): StoredOAuthGrant | null {
  const raw = config[OAUTH_CONFIG_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const grant = raw as Partial<StoredOAuthGrant>;
  if (typeof grant.encryptedRefreshToken !== 'string') return null;
  return {
    encryptedRefreshToken: grant.encryptedRefreshToken,
    encryptedAccessToken:
      typeof grant.encryptedAccessToken === 'string' ? grant.encryptedAccessToken : null,
    accessTokenExpiresAt:
      typeof grant.accessTokenExpiresAt === 'string' ? grant.accessTokenExpiresAt : null,
    scopes: Array.isArray(grant.scopes) ? grant.scopes.filter((s) => typeof s === 'string') : [],
    connectedAt: typeof grant.connectedAt === 'string' ? grant.connectedAt : '',
  };
}

@Injectable()
export class ConnectorOAuthService {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    @Inject(ConnectorRegistry) private readonly registry: ConnectorRegistry,
    @Inject(DB) private readonly rootDb?: Db,
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
    return () => {
      const pending = this.inFlight.get(row.id);
      if (pending) return pending;
      const task = this.resolveAccessToken(row).finally(() => this.inFlight.delete(row.id));
      this.inFlight.set(row.id, task);
      return task;
    };
  }

  async revoke(row: ConnectionRow): Promise<void> {
    const adapter = this.registry.get(row.vendor);
    if (!adapter?.oauth) return;
    const oauth = adapter.oauth;
    await this.withConnection(row.id, row.orgId, async (tx, current) => {
      const grant = readStoredGrant(current.config);
      if (!grant) return;
      const client = await this.decryptClient(tx, current.config, oauth, adapter);
      const refreshToken = await decryptOn(tx, grant.encryptedRefreshToken);
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
    const outcome = await this.refreshUnderLock(row);
    if ('revoked' in outcome) {
      await this.markExpired(row, outcome.revoked);
      throw new BadRequestException(
        `connectors_expired: ${outcome.displayName} no longer accepts this connection's grant (${outcome.revoked}) — reconnect it with connectors_get_authorize_url`,
      );
    }
    return outcome.token;
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

  private async refreshUnderLock(
    row: ConnectionRow,
  ): Promise<{ token: string } | { revoked: string; displayName: string }> {
    return this.withConnection(row.id, row.orgId, async (tx, current) => {
      const { adapter, oauth } = this.requireOAuthAdapter(current.vendor);
      const grant = readStoredGrant(current.config);
      if (!grant) {
        throw new BadRequestException(
          `connectors_invalid: connection ${current.name} has not been authorized yet — open the link from connectors_get_authorize_url`,
        );
      }
      if (grant.encryptedAccessToken && !isExpired(grant.accessTokenExpiresAt)) {
        return { token: await decryptOn(tx, grant.encryptedAccessToken) };
      }
      const client = await this.decryptClient(tx, current.config, oauth, adapter);
      const refreshToken = await decryptOn(tx, grant.encryptedRefreshToken);
      let tokens: OAuthTokenSet;
      try {
        tokens = await oauth.refresh({ refreshToken, client });
      } catch (err) {
        if (err instanceof OAuthGrantRevokedError) {
          return { revoked: err.message, displayName: adapter.displayName };
        }
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
    const encryptedRefreshToken = tokens.refreshToken
      ? await encryptOn(tx, tokens.refreshToken)
      : previous?.encryptedRefreshToken;
    if (!encryptedRefreshToken) {
      throw new ConnectorVendorError('refresh token missing from the vendor response');
    }
    return {
      encryptedRefreshToken,
      encryptedAccessToken: await encryptOn(tx, tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresInSeconds
        ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString()
        : null,
      scopes: [...oauth.authorizationScopes],
      connectedAt: previous?.connectedAt || new Date().toISOString(),
    };
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
    return { clientId, clientSecret: await decryptOn(tx, encryptedSecret) };
  }

  private async withConnection<T>(
    connectionId: string,
    expectedOrgId: string,
    fn: (tx: Tx, row: ConnectionRow) => Promise<T>,
  ): Promise<T> {
    const rootDb = this.rootDb;
    if (!rootDb) throw new Error('root db not available');
    return rootDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx
        .select()
        .from(schema.connectorConnections)
        .where(eq(schema.connectorConnections.id, connectionId))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new NotFoundException(`connectors_not_found: connection ${connectionId} not found`);
      }
      if (row.orgId !== expectedOrgId) {
        throw new NotFoundException(`connectors_not_found: connection ${connectionId} not found`);
      }
      return fn(tx, row);
    });
  }
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return true;
  return ms - REFRESH_SKEW_MS <= Date.now();
}

async function encryptOn(tx: Tx, plaintext: string): Promise<string> {
  await tx.execute(setEncryptionKeySql());
  const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new ConnectorVendorError('encryption failed');
  return ct;
}

async function decryptOn(tx: Tx, ciphertext: string): Promise<string> {
  await tx.execute(setEncryptionKeySql());
  const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
  );
  const pt = rows[0]?.pt;
  if (pt === undefined || pt === null) {
    throw new ConnectorVendorError('stored credential could not be decrypted');
  }
  return pt;
}

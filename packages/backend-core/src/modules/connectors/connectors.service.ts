import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
  SsrfBlockedError,
} from '@getmunin/core';
import {
  ConnectorRegistry,
  audienceForDomain,
  supportsToolCatalog,
  type ConnectorAdapter,
  type ConnectorCapabilityFilter,
  type ConnectorConnectionContext,
  type ConnectorAudience,
  type ConnectorDomain,
  type SelectableTool,
  type ToolCatalogAdapter,
} from './connector.ts';
import { SecretCipherError } from '../../common/outbound-oauth/grant-store.ts';
import { ConnectorVendorError } from './http.ts';
import { isSelfReportedIdentity } from './identity-provenance.ts';
import { readLatestTurnSenderAuthBlock } from './latest-turn-sender-auth.ts';
import { ConnectorOAuthService, OAUTH_CONFIG_KEY } from './connector-oauth.service.ts';
import { DB } from '../../common/db/db.module.ts';
import { CredentialHandoffService, type CredentialLink } from '../credential-handoff/credential-handoff.service.ts';
import type {
  CredentialApplyResult,
  CredentialTargetDescription,
} from '../credential-handoff/credential-target.ts';

export type ConnectionRow = typeof schema.connectorConnections.$inferSelect;

export type CredentialState = 'active' | 'pending' | 'expired' | 'revoked';

export interface ConnectorConnectionDto {
  id: string;
  vendor: string;
  domain: ConnectorDomain;
  name: string;
  active: boolean;
  credentialState: CredentialState;
  audience: ConnectorAudience;
  settings: Record<string, unknown>;
  needsAuthorization: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  createdAt: string;
}

export interface ConnectorVendorDto {
  vendor: string;
  domain: ConnectorDomain;
  displayName: string;
  audience: ConnectorAudience;
  oauth: boolean;
  configFields: Array<{
    key: string;
    label: string;
    required: boolean;
    secret?: boolean;
    placeholder?: string;
  }>;
}

export interface ConnectionSummary {
  id: string;
  name: string;
  vendor: string;
}

export interface AuthorizeLink {
  url: string;
  expiresAt: string;
}

export interface ConnectionScope {
  connection: ConnectionRow;
  adapter: ConnectorAdapter;
}

export interface CredentialLinkMinter {
  mint(args: { targetType: string; targetId: string }): Promise<CredentialLink>;
}

@Injectable()
export class ConnectorsService {
  constructor(
    @Inject(ConnectorRegistry) private readonly registry: ConnectorRegistry,
    @Inject(CredentialHandoffService)
    private readonly handoff?: CredentialLinkMinter,
    @Inject(DB) private readonly rootDb?: Db,
    @Inject(ConnectorOAuthService) private readonly oauth?: ConnectorOAuthService,
  ) {}

  private requireOAuth(): ConnectorOAuthService {
    if (!this.oauth) throw new Error('connector oauth service not available');
    return this.oauth;
  }

  private requireHandoff(): CredentialLinkMinter {
    if (!this.handoff) throw new Error('credential handoff service not available');
    return this.handoff;
  }

  private requireRootDb(): Db {
    if (!this.rootDb) throw new Error('root db not available');
    return this.rootDb;
  }

  listVendors(): ConnectorVendorDto[] {
    return this.registry.list().map((adapter) => ({
      vendor: adapter.vendor,
      domain: adapter.domain,
      displayName: adapter.displayName,
      audience: audienceForDomain(adapter.domain),
      configFields: adapter.configFields,
      oauth: !!adapter.oauth,
    }));
  }

  async listConnections(): Promise<ConnectorConnectionDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.connectorConnections)
      .orderBy(schema.connectorConnections.createdAt);
    return rows.map((row) => this.toDto(row));
  }

  async listActiveDomains(
    orgId: string,
    domains: readonly ConnectorDomain[],
    db?: Db | Tx,
  ): Promise<Set<ConnectorDomain>> {
    if (domains.length === 0) return new Set();
    const rows = await (db ?? this.requireRootDb())
      .selectDistinct({ domain: schema.connectorConnections.domain })
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.orgId, orgId),
          inArray(schema.connectorConnections.domain, [...domains]),
          eq(schema.connectorConnections.active, true),
        ),
      );
    return new Set(rows.map((r) => r.domain as ConnectorDomain));
  }

  async createConnection(
    args: {
      vendor: string;
      name: string;
      config?: Record<string, unknown>;
    },
    opts?: { rejectSecrets?: boolean },
  ): Promise<
    ConnectorConnectionDto & { credentialLink?: CredentialLink; authorize?: AuthorizeLink }
  > {
    const ctx = getCurrentContext();
    const adapter = this.requireAdapter(args.vendor);
    await this.assertNameFree(args.name);
    const config = args.config ?? {};
    if (opts?.rejectSecrets) this.assertNoSecrets(adapter, config);

    if (this.hasRequiredSecrets(adapter, config)) {
      const stored = await this.buildStored(adapter, config);
      const [row] = await ctx.db
        .insert(schema.connectorConnections)
        .values({
          orgId: ctx.actor!.orgId,
          vendor: adapter.vendor,
          domain: adapter.domain,
          name: args.name,
          config: stored,
          active: !adapter.oauth,
          credentialState: adapter.oauth ? 'pending' : 'active',
        })
        .returning();
      if (adapter.oauth) {
        return { ...this.toDto(row!), authorize: this.requireOAuth().authorizeUrl(row!) };
      }
      return this.toDto(row!);
    }

    const missing = adapter.configFields
      .filter((f) => !f.secret && f.required)
      .filter((f) => {
        const v = config[f.key];
        return typeof v !== 'string' || v.length === 0;
      })
      .map((f) => f.key);
    if (missing.length > 0) {
      throw new BadRequestException(
        `connectors_invalid: missing required config for ${adapter.vendor}: ${missing.join(', ')} — only secret fields can be deferred to the credential link`,
      );
    }

    const [row] = await ctx.db
      .insert(schema.connectorConnections)
      .values({
        orgId: ctx.actor!.orgId,
        vendor: adapter.vendor,
        domain: adapter.domain,
        name: args.name,
        config: this.pickNonSecret(adapter, config),
        active: false,
        credentialState: 'pending',
      })
      .returning();
    const credentialLink = await this.requireHandoff().mint({
      targetType: 'connector',
      targetId: row!.id,
    });
    return { ...this.toDto(row!), credentialLink };
  }

  async requestCredentials(args: { connectionId: string }): Promise<CredentialLink> {
    const row = await this.requireConnection(args.connectionId);
    if (row.credentialState !== 'pending') {
      throw new BadRequestException(
        'connectors_invalid: connection already has credentials; delete and recreate to rotate',
      );
    }
    return this.requireHandoff().mint({ targetType: 'connector', targetId: row.id });
  }

  async describeCredentials(connectionId: string): Promise<CredentialTargetDescription | null> {
    const rows = await getCurrentContext()
      .db.select()
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.id, connectionId))
      .limit(1);
    const row = rows[0];
    if (!row || row.credentialState !== 'pending') return null;
    const adapter = this.requireAdapter(row.vendor);
    return {
      label: row.name,
      vendor: adapter.vendor,
      fields: adapter.configFields
        .filter((f) => f.secret)
        .map((f) => ({
          key: f.key,
          label: f.label,
          required: f.required,
          placeholder: f.placeholder,
        })),
    };
  }

  async saveCredentials(
    connectionId: string,
    secrets: Record<string, string>,
  ): Promise<CredentialApplyResult> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(connectionId);
    const adapter = this.requireAdapter(row.vendor);
    const stored = await this.buildStored(adapter, { ...(row.config ?? {}), ...secrets });
    const grant = row.config?.[OAUTH_CONFIG_KEY];
    await ctx.db
      .update(schema.connectorConnections)
      .set({
        config: grant === undefined ? stored : { ...stored, [OAUTH_CONFIG_KEY]: grant },
        active: !adapter.oauth,
        credentialState: adapter.oauth ? 'pending' : 'active',
        lastTestedAt: null,
        lastTestError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.connectorConnections.id, row.id));
    return { ok: true, detail: 'credentials saved' };
  }

  async applyCredentials(
    connectionId: string,
    secrets: Record<string, string>,
  ): Promise<CredentialApplyResult> {
    await this.saveCredentials(connectionId, secrets);
    const row = await this.requireConnection(connectionId);
    const adapter = this.requireAdapter(row.vendor);
    if (adapter.oauth) {
      return {
        ok: true,
        detail: `client credentials saved — ${adapter.displayName} still needs its access grant, so open the link from connectors_get_authorize_url to finish connecting`,
      };
    }
    return this.testConnection({ connectionId });
  }

  async authorizeUrl(args: { connectionId: string }): Promise<AuthorizeLink> {
    const row = await this.requireConnection(args.connectionId);
    return this.requireOAuth().authorizeUrl(row);
  }

  async verifyConnection(connectionId: string): Promise<CredentialApplyResult> {
    const rootDb = this.requireRootDb();
    const orgId = getCurrentContext().actor?.orgId;
    const applyScope = async (tx: Tx): Promise<void> => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      if (orgId) await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
    };
    const row = await rootDb.transaction(async (tx) => {
      await applyScope(tx);
      const rows = await tx
        .select()
        .from(schema.connectorConnections)
        .where(eq(schema.connectorConnections.id, connectionId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!row) return { ok: false, error: 'connection no longer exists' };
    const adapter = this.requireAdapter(row.vendor);
    const probe = await this.probeDetached(adapter, row.config);
    await rootDb.transaction(async (tx) => {
      await applyScope(tx);
      await tx
        .update(schema.connectorConnections)
        .set({
          lastTestedAt: new Date(),
          lastTestError: probe.ok ? null : (probe.error ?? null),
          updatedAt: new Date(),
        })
        .where(eq(schema.connectorConnections.id, row.id));
    });
    return probe;
  }

  private async probeDetached(
    adapter: ConnectorAdapter,
    stored: Record<string, unknown>,
  ): Promise<CredentialApplyResult> {
    try {
      const result = await adapter.testConnection({
        config: stored,
        decryptSecret: (ciphertext) => this.decryptDetached(ciphertext),
      });
      return { ok: true, detail: result.detail };
    } catch (err) {
      if (err instanceof ConnectorVendorError || err instanceof SsrfBlockedError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
  }

  private async decryptDetached(ciphertext: string): Promise<string> {
    return this.requireRootDb().transaction(async (tx) => {
      await tx.execute(setEncryptionKeySql());
      const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
        sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
      );
      const pt = rows[0]?.pt;
      if (pt === undefined || pt === null) {
        throw new ConnectorVendorError('stored credential could not be decrypted');
      }
      return pt;
    });
  }

  private assertSecretFollowsEndpoint(
    adapter: ConnectorAdapter,
    input: Record<string, unknown>,
    previous: Record<string, unknown> | null,
    next: Record<string, unknown>,
  ): void {
    const secrets = this.secretKeys(adapter);
    if (secrets.length === 0 || secrets.some((k) => input[k] !== undefined)) return;
    const moved = adapter.configFields
      .filter((f) => f.endpoint)
      .map((f) => f.key)
      .filter((k) => destinationOf(previous?.[k]) !== destinationOf(next[k]));
    if (moved.length === 0) return;
    throw new BadRequestException({
      message: `${SECRET_REQUIRED_CODE}: changing ${moved.join(', ')} points this connection at a different host, so the stored ${secrets.join(', ')} will not be sent there — supply the credential again in the same change (a person does this in the dashboard), or delete the connection and create it again to get a fresh credential link`,
      code: SECRET_REQUIRED_CODE,
    });
  }

  private secretKeys(adapter: ConnectorAdapter): string[] {
    return adapter.configFields.filter((f) => f.secret).map((f) => f.key);
  }

  private hasRequiredSecrets(adapter: ConnectorAdapter, config: Record<string, unknown>): boolean {
    const required = adapter.configFields.filter((f) => f.secret && f.required);
    return required.every((f) => {
      const v = config[f.key];
      return typeof v === 'string' && v.length > 0;
    });
  }

  private pickNonSecret(
    adapter: ConnectorAdapter,
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    const secret = new Set(this.secretKeys(adapter));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      if (!secret.has(k)) out[k] = v;
    }
    return out;
  }

  private assertNoSecrets(adapter: ConnectorAdapter, config: Record<string, unknown>): void {
    const provided = this.secretKeys(adapter).filter((k) => config[k] !== undefined);
    if (provided.length > 0) {
      throw new BadRequestException(
        `connectors_invalid: secret fields (${provided.join(', ')}) cannot be accepted through this tool — omit them, and a one-time credential link is returned for a human to enter them in the dashboard`,
      );
    }
  }

  async updateConnection(
    args: {
      connectionId: string;
      name?: string;
      config?: Record<string, unknown>;
      active?: boolean;
    },
    opts?: { rejectSecrets?: boolean },
  ): Promise<ConnectorConnectionDto> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    const adapter = this.requireAdapter(row.vendor);
    if (opts?.rejectSecrets && args.config) this.assertNoSecrets(adapter, args.config);
    if (args.name && args.name !== row.name) await this.assertNameFree(args.name);
    const patch: Partial<typeof schema.connectorConnections.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (args.name !== undefined) patch.name = args.name;
    if (args.active !== undefined) patch.active = args.active;
    if (args.config !== undefined) {
      patch.config = await this.buildStored(adapter, args.config, row.config);
      this.assertSecretFollowsEndpoint(adapter, args.config, row.config, patch.config);
    }
    const [updated] = await ctx.db
      .update(schema.connectorConnections)
      .set(patch)
      .where(eq(schema.connectorConnections.id, row.id))
      .returning();
    return this.toDto(updated!);
  }

  async listSelectableTools(args: { connectionId: string }): Promise<{ tools: SelectableTool[] }> {
    const row = await this.requireConnection(args.connectionId);
    const adapter = this.requireToolCatalogAdapter(row);
    if (row.credentialState === 'pending') {
      throw new BadRequestException(
        'connectors_invalid: connection is awaiting credentials — complete the credential link first',
      );
    }
    const tools = await this.vendorCall(() =>
      adapter.listSelectableTools(this.connectionContext(row)),
    );
    return { tools };
  }

  async setAllowedTools(args: {
    connectionId: string;
    toolNames: string[];
  }): Promise<ConnectorConnectionDto> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    const adapter = this.requireToolCatalogAdapter(row);
    const config = adapter.applyAllowedTools(row.config, args.toolNames);
    const [updated] = await ctx.db
      .update(schema.connectorConnections)
      .set({ config, updatedAt: new Date() })
      .where(eq(schema.connectorConnections.id, row.id))
      .returning();
    return this.toDto(updated!);
  }

  private requireToolCatalogAdapter(row: ConnectionRow): ConnectorAdapter & ToolCatalogAdapter {
    const adapter = this.requireAdapter(row.vendor);
    if (!supportsToolCatalog(adapter)) {
      throw new BadRequestException(
        `connectors_invalid: ${adapter.vendor} connections do not expose a selectable tool list`,
      );
    }
    return adapter;
  }

  async deleteConnection(args: { connectionId: string }): Promise<{ deleted: true; id: string }> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    const bound = await ctx.db
      .select({ name: schema.convChannels.name })
      .from(schema.convChannelConnections)
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convChannelConnections.channelId),
      )
      .where(eq(schema.convChannelConnections.connectionId, row.id));
    if (bound.length > 0) {
      const names = bound.map((b) => b.name).join(', ');
      throw new ConflictException({
        message: `connectors_connection_bound: connection ${row.name} is bound to channel(s) ${names}; remove it from those channels with conv_set_channel_sources first`,
        code: 'connectors_connection_bound',
        params: { channels: names },
      });
    }
    if (this.requireAdapter(row.vendor).oauth) await this.requireOAuth().revoke(row);
    await ctx.db
      .delete(schema.connectorConnections)
      .where(eq(schema.connectorConnections.id, row.id));
    return { deleted: true, id: row.id };
  }

  async testConnection(args: {
    connectionId: string;
  }): Promise<{ ok: boolean; detail?: string; summary?: string; error?: string }> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    if (row.credentialState === 'pending') {
      throw new BadRequestException(
        'connectors_invalid: connection is awaiting credentials — complete the credential link first',
      );
    }
    const adapter = this.requireAdapter(row.vendor);
    try {
      const result = await adapter.testConnection(this.connectionContext(row));
      await ctx.db
        .update(schema.connectorConnections)
        .set({ lastTestedAt: new Date(), lastTestError: null, updatedAt: new Date() })
        .where(eq(schema.connectorConnections.id, row.id));
      return { ok: true, detail: result.detail, summary: result.summary };
    } catch (err) {
      if (!(err instanceof ConnectorVendorError) && !(err instanceof SsrfBlockedError)) throw err;
      const message = err.message;
      await ctx.db
        .update(schema.connectorConnections)
        .set({ lastTestedAt: new Date(), lastTestError: message, updatedAt: new Date() })
        .where(eq(schema.connectorConnections.id, row.id));
      return { ok: false, error: message };
    }
  }

  async resolveScope(
    domain: ConnectorDomain,
    requestedConnectionId?: string,
    capability?: ConnectorCapabilityFilter,
  ): Promise<ConnectionScope> {
    const ctx = getCurrentContext();
    const label = capability ? `${domain} (${capability.label})` : domain;
    const bound = await this.channelBoundConnectionId(domain);
    if (bound && requestedConnectionId && requestedConnectionId !== bound) {
      throw new BadRequestException(
        `connectors_invalid: this conversation's channel is bound to connection ${bound} for ${domain}; connection ${requestedConnectionId} is not available here`,
      );
    }
    const connectionId = bound ?? requestedConnectionId;
    if (connectionId) {
      const row = await this.requireConnection(connectionId);
      if (row.domain !== domain) {
        throw new BadRequestException(
          `connectors_invalid: connection ${row.name} is a ${row.domain} connection, not ${domain}`,
        );
      }
      const adapter = this.requireAdapter(row.vendor);
      if (capability && !capability.accept(adapter)) {
        throw new BadRequestException(
          `connectors_invalid: connection ${row.name} is a ${adapter.displayName} connection, which does not provide ${capability.label}`,
        );
      }
      if (!row.active) {
        throw new BadRequestException(`connectors_invalid: connection ${row.name} is not active`);
      }
      return { connection: row, adapter };
    }
    const vendors = capability
      ? this.registry
          .listByDomain(domain)
          .filter((a) => capability.accept(a))
          .map((a) => a.vendor)
      : null;
    if (vendors && vendors.length === 0) {
      throw new BadRequestException(`connectors_invalid: no active ${label} connection configured`);
    }
    const vendorFilter = vendors ? inArray(schema.connectorConnections.vendor, vendors) : undefined;
    const rows = await ctx.db
      .select()
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.domain, domain),
          eq(schema.connectorConnections.active, true),
          vendorFilter,
        ),
      );
    if (rows.length === 0) {
      const unusable = await ctx.db
        .select({
          name: schema.connectorConnections.name,
          credentialState: schema.connectorConnections.credentialState,
        })
        .from(schema.connectorConnections)
        .where(and(eq(schema.connectorConnections.domain, domain), vendorFilter));
      if (unusable.length > 0) {
        const detail = unusable.map((r) => `${r.name} (${r.credentialState})`).join(', ');
        throw new BadRequestException(
          `connectors_invalid: no active ${label} connection — ${detail}. Finish or renew the connection before using these tools.`,
        );
      }
      throw new BadRequestException(
        `connectors_invalid: no active ${label} connection configured`,
      );
    }
    if (rows.length > 1) {
      const names = rows.map((r) => `${r.name} (${r.id})`).join(', ');
      throw new BadRequestException(
        `connectors_invalid: multiple active ${label} connections — pass connectionId. Available: ${names}`,
      );
    }
    return { connection: rows[0]!, adapter: this.requireAdapter(rows[0]!.vendor) };
  }

  private async channelBoundConnectionId(domain: ConnectorDomain): Promise<string | null> {
    const ctx = getCurrentContext();
    const actor = ctx.actor;
    if (!actor?.endUserId || !actor.conversationId) return null;
    const rows = await ctx.db
      .select({ connectionId: schema.convChannelConnections.connectionId })
      .from(schema.convChannelConnections)
      .innerJoin(
        schema.convConversations,
        eq(schema.convConversations.channelId, schema.convChannelConnections.channelId),
      )
      .where(
        and(
          eq(schema.convConversations.id, actor.conversationId),
          eq(schema.convChannelConnections.domain, domain),
        ),
      )
      .limit(1);
    return rows[0]?.connectionId ?? null;
  }

  async requireEndUserEmail(): Promise<string> {
    return refuseUnlessVerified(await this.assessEndUserEmail());
  }

  async optionalEndUserEmail(): Promise<string | null> {
    const verdict = await this.assessEndUserEmail();
    if (!verdict.ok && (verdict.refusal === 'no_email' || verdict.refusal === 'self_reported')) {
      return null;
    }
    return refuseUnlessVerified(verdict);
  }

  private async assessEndUserEmail(): Promise<EndUserEmailVerdict> {
    const ctx = getCurrentContext();
    const actor = ctx.actor;
    if (!actor?.endUserId) return { ok: false, refusal: 'no_end_user' };
    const rows = await ctx.db
      .select({ email: schema.endUsers.email, metadata: schema.endUsers.metadata })
      .from(schema.endUsers)
      .where(eq(schema.endUsers.id, actor.endUserId))
      .limit(1);
    const email = rows[0]?.email;
    if (!email) return { ok: false, refusal: 'no_email' };
    if (isSelfReportedIdentity({ email, metadata: rows[0]?.metadata })) {
      return { ok: false, refusal: 'self_reported' };
    }
    const block = await readLatestTurnSenderAuthBlock(ctx.db, actor);
    if (block === 'fail') return { ok: false, refusal: 'sender_auth_failed' };
    if (block === 'forwarded') return { ok: false, refusal: 'sender_forwarded' };
    return { ok: true, email };
  }

  connectionContext(row: ConnectionRow): ConnectorConnectionContext {
    const adapter = this.registry.get(row.vendor);
    return {
      config: row.config,
      decryptSecret: (ciphertext) => decryptString(ciphertext),
      accessToken: adapter?.oauth ? this.requireOAuth().accessTokenFor(row) : undefined,
    };
  }

  async vendorCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new BadRequestException(`connectors_invalid: vendor host blocked: ${err.message}`);
      }
      if (err instanceof ConnectorVendorError || err instanceof SecretCipherError) {
        throw new BadGatewayException(`connectors_vendor_error: ${err.message}`);
      }
      throw err;
    }
  }

  private requireAdapter(vendor: string): ConnectorAdapter {
    const adapter = this.registry.get(vendor);
    if (!adapter) {
      const known = this.registry
        .list()
        .map((a) => a.vendor)
        .join(', ');
      throw new BadRequestException(
        `connectors_invalid: unknown vendor ${vendor}. Known: ${known}`,
      );
    }
    return adapter;
  }

  private async requireConnection(connectionId: string): Promise<ConnectionRow> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.id, connectionId))
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException(`connectors_not_found: connection ${connectionId} not found`);
    }
    return rows[0];
  }

  private async assertNameFree(name: string): Promise<void> {
    const ctx = getCurrentContext();
    const existing = await ctx.db
      .select({ id: schema.connectorConnections.id })
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.orgId, ctx.actor!.orgId),
          eq(schema.connectorConnections.name, name),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new BadRequestException(
        `connectors_conflict: a connection named "${name}" already exists`,
      );
    }
  }

  private async buildStored(
    adapter: ConnectorAdapter,
    config: Record<string, unknown>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = adapter.configInput.safeParse(config);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      const summary = fieldErrors
        .map((fe) => (fe.field ? `${fe.field}: ${fe.message}` : fe.message))
        .join('; ');
      throw new BadRequestException({
        message: `connectors_invalid: config for ${adapter.vendor}: ${summary}`,
        fieldErrors,
      });
    }
    try {
      return await adapter.buildStoredConfig(
        parsed.data as Record<string, unknown>,
        encryptString,
        previous,
      );
    } catch (err) {
      if (err instanceof ConnectorVendorError) {
        throw new BadRequestException(`connectors_invalid: ${err.message}`);
      }
      throw err;
    }
  }

  private toDto(row: ConnectionRow): ConnectorConnectionDto {
    const adapter = this.requireAdapter(row.vendor);
    const state = row.credentialState as CredentialState;
    return {
      id: row.id,
      vendor: row.vendor,
      domain: row.domain as ConnectorDomain,
      name: row.name,
      active: row.active,
      credentialState: state,
      audience: audienceForDomain(row.domain as ConnectorDomain),
      settings: state === 'pending' ? withoutGrant(row.config) : adapter.publicConfig(row.config),
      needsAuthorization: !!adapter.oauth && state !== 'active',
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastTestError: row.lastTestError,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export function connectionSummary(row: ConnectionRow): ConnectionSummary {
  return { id: row.id, name: row.name, vendor: row.vendor };
}

function withoutGrant(config: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...config };
  delete rest[OAUTH_CONFIG_KEY];
  return rest;
}

const SECRET_REQUIRED_CODE = 'connectors_secret_required';

function destinationOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim().toLowerCase();
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return trimmed;
  }
}

async function encryptString(plaintext: string): Promise<string> {
  const ctx = getCurrentContext();
  await ctx.db.execute(setEncryptionKeySql());
  const rows = await ctx.db.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new BadRequestException('connectors_invalid: encryption failed');
  return ct;
}

async function decryptString(ciphertext: string): Promise<string> {
  const ctx = getCurrentContext();
  await ctx.db.execute(setEncryptionKeySql());
  const rows = await ctx.db.execute<{ pt: string } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
  );
  const pt = rows[0]?.pt;
  if (pt === undefined || pt === null) {
    throw new ConnectorVendorError('stored credential could not be decrypted');
  }
  return pt;
}

type EndUserEmailVerdict =
  | { ok: true; email: string }
  | {
      ok: false;
      refusal: 'no_end_user' | 'no_email' | 'self_reported' | 'sender_auth_failed' | 'sender_forwarded';
    };

const END_USER_EMAIL_REFUSALS: Record<Exclude<EndUserEmailVerdict, { ok: true }>['refusal'], string> = {
  no_end_user: 'connectors_invalid: end-user identity required',
  no_email: 'connectors_invalid: your session has no email identity, which this lookup requires',
  self_reported:
    'connectors_unverified: this email was self-reported in chat and is not verified, so personal lookups are not allowed; ask the customer to write in from their email address or use a signed-in session',
  sender_auth_failed:
    "connectors_sender_auth_failed: the latest customer message in this conversation failed its DMARC check for the address it claims to come from, so it may be forged and cannot be used to look up or change that address's orders or bookings. Hand over to a human.",
  sender_forwarded:
    "connectors_sender_forwarded: the latest customer message in this conversation was forwarded, so its original sender comes from the forwarded text rather than an authenticated address and cannot be used to look up or change that address's orders or bookings. Hand over to a human.",
};

function refuseUnlessVerified(verdict: EndUserEmailVerdict): string {
  if (verdict.ok) return verdict.email;
  throw new BadRequestException(END_USER_EMAIL_REFUSALS[verdict.refusal]);
}

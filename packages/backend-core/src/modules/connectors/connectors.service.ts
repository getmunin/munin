import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import {
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
  SsrfBlockedError,
} from '@getmunin/core';
import {
  ConnectorRegistry,
  type ConnectorAdapter,
  type ConnectorConnectionContext,
  type ConnectorDomain,
} from './connector.ts';
import { ConnectorVendorError } from './http.ts';

export type ConnectionRow = typeof schema.connectorConnections.$inferSelect;

export interface ConnectorConnectionDto {
  id: string;
  vendor: string;
  domain: ConnectorDomain;
  name: string;
  active: boolean;
  settings: Record<string, unknown>;
  lastTestedAt: string | null;
  lastTestError: string | null;
  createdAt: string;
}

export interface ConnectorVendorDto {
  vendor: string;
  domain: ConnectorDomain;
  displayName: string;
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

export interface ConnectionScope {
  connection: ConnectionRow;
  adapter: ConnectorAdapter;
}

/**
 * Domain-agnostic trunk: connection storage and lifecycle, plus the shared
 * helpers domain services (commerce, bookings, …) build their typed read
 * surfaces on. Deliberately knows nothing about orders or reservations.
 */
@Injectable()
export class ConnectorsService {
  constructor(@Inject(ConnectorRegistry) private readonly registry: ConnectorRegistry) {}

  listVendors(): ConnectorVendorDto[] {
    return this.registry.list().map((adapter) => ({
      vendor: adapter.vendor,
      domain: adapter.domain,
      displayName: adapter.displayName,
      configFields: adapter.configFields,
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

  async createConnection(args: {
    vendor: string;
    name: string;
    config: Record<string, unknown>;
  }): Promise<ConnectorConnectionDto> {
    const ctx = getCurrentContext();
    const adapter = this.requireAdapter(args.vendor);
    await this.assertNameFree(args.name);
    const stored = await this.buildStored(adapter, args.config);
    const [row] = await ctx.db
      .insert(schema.connectorConnections)
      .values({
        orgId: ctx.actor!.orgId,
        vendor: adapter.vendor,
        domain: adapter.domain,
        name: args.name,
        config: stored,
      })
      .returning();
    return this.toDto(row!);
  }

  async updateConnection(args: {
    connectionId: string;
    name?: string;
    config?: Record<string, unknown>;
    active?: boolean;
  }): Promise<ConnectorConnectionDto> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    const adapter = this.requireAdapter(row.vendor);
    if (args.name && args.name !== row.name) await this.assertNameFree(args.name);
    const patch: Partial<typeof schema.connectorConnections.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (args.name !== undefined) patch.name = args.name;
    if (args.active !== undefined) patch.active = args.active;
    if (args.config !== undefined) {
      patch.config = await this.buildStored(adapter, args.config, row.config);
    }
    const [updated] = await ctx.db
      .update(schema.connectorConnections)
      .set(patch)
      .where(eq(schema.connectorConnections.id, row.id))
      .returning();
    return this.toDto(updated!);
  }

  async deleteConnection(args: { connectionId: string }): Promise<{ deleted: true; id: string }> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    await ctx.db
      .delete(schema.connectorConnections)
      .where(eq(schema.connectorConnections.id, row.id));
    return { deleted: true, id: row.id };
  }

  async testConnection(args: {
    connectionId: string;
  }): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const ctx = getCurrentContext();
    const row = await this.requireConnection(args.connectionId);
    const adapter = this.requireAdapter(row.vendor);
    try {
      const result = await adapter.testConnection(this.connectionContext(row));
      await ctx.db
        .update(schema.connectorConnections)
        .set({ lastTestedAt: new Date(), lastTestError: null, updatedAt: new Date() })
        .where(eq(schema.connectorConnections.id, row.id));
      return { ok: true, detail: result.detail };
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

  /**
   * Pick the connection a domain read runs against: an explicit id (which
   * must belong to `domain` and be active), or the single active connection
   * in that domain.
   */
  async resolveScope(domain: ConnectorDomain, connectionId?: string): Promise<ConnectionScope> {
    const ctx = getCurrentContext();
    if (connectionId) {
      const row = await this.requireConnection(connectionId);
      if (row.domain !== domain) {
        throw new BadRequestException(
          `connectors_invalid: connection ${row.name} is a ${row.domain} connection, not ${domain}`,
        );
      }
      if (!row.active) {
        throw new BadRequestException(`connectors_invalid: connection ${row.name} is not active`);
      }
      return { connection: row, adapter: this.requireAdapter(row.vendor) };
    }
    const rows = await ctx.db
      .select()
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.domain, domain),
          eq(schema.connectorConnections.active, true),
        ),
      );
    if (rows.length === 0) {
      throw new BadRequestException(
        `connectors_invalid: no active ${domain} connection configured`,
      );
    }
    if (rows.length > 1) {
      const names = rows.map((r) => `${r.name} (${r.id})`).join(', ');
      throw new BadRequestException(
        `connectors_invalid: multiple active ${domain} connections — pass connectionId. Available: ${names}`,
      );
    }
    return { connection: rows[0]!, adapter: this.requireAdapter(rows[0]!.vendor) };
  }

  /**
   * The identity a self-service lookup runs as. Always the calling end-user's
   * own email — never caller-supplied — so a delegated token can only ever see
   * the records of the person the org minted it for.
   */
  async requireEndUserEmail(): Promise<string> {
    const ctx = getCurrentContext();
    const endUserId = ctx.actor?.endUserId;
    if (!endUserId) {
      throw new BadRequestException('connectors_invalid: end-user identity required');
    }
    const rows = await ctx.db
      .select({ email: schema.endUsers.email })
      .from(schema.endUsers)
      .where(eq(schema.endUsers.id, endUserId))
      .limit(1);
    const email = rows[0]?.email;
    if (!email) {
      throw new BadRequestException(
        'connectors_invalid: your session has no email identity, which this lookup requires',
      );
    }
    return email;
  }

  connectionContext(row: ConnectionRow): ConnectorConnectionContext {
    return {
      config: row.config,
      decryptSecret: (ciphertext) => decryptString(ciphertext),
    };
  }

  async vendorCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new BadRequestException(`connectors_invalid: vendor host blocked: ${err.message}`);
      }
      if (err instanceof ConnectorVendorError) {
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
      throw new BadRequestException(
        `connectors_invalid: config for ${adapter.vendor}: ${parsed.error.message}`,
      );
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
    return {
      id: row.id,
      vendor: row.vendor,
      domain: row.domain as ConnectorDomain,
      name: row.name,
      active: row.active,
      settings: adapter.publicConfig(row.config),
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastTestError: row.lastTestError,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export function connectionSummary(row: ConnectionRow): ConnectionSummary {
  return { id: row.id, name: row.name, vendor: row.vendor };
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

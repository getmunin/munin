import type { z } from 'zod';

/**
 * Base contract for third-party system connectors.
 *
 * A connector belongs to exactly one *domain* — the product surface its data
 * feeds (commerce → orders, bookings → reservations). The trunk owns what is
 * domain-agnostic: encrypted connection storage, the connectors_* admin CRUD
 * tools, credential testing, and the end-user identity bridge. Each domain
 * submodule extends this contract with its own typed read methods and its own
 * domain tools — domain contracts are deliberately NOT unified; a generic
 * query surface would defeat the narrow, reviewable tool design.
 *
 * Stored connection config is vendor-shaped JSONB. Secret fields are
 * pgcrypto-encrypted before storage (`encryptSecret`) and only decrypted
 * inside adapter calls (`ctx.decryptSecret`). `publicConfig()` is the only
 * projection that may leave the service layer.
 */
export interface ConnectorAdapter {
  readonly vendor: string;
  readonly domain: ConnectorDomain;
  readonly displayName: string;
  /** Plaintext admin input schema; drives connectors_create/update_connection validation. */
  readonly configInput: z.ZodType;
  readonly configFields: ConnectorConfigFieldInfo[];

  /**
   * Turn validated admin input into the stored config, encrypting secrets.
   * On update, `previous` carries the currently stored config so omitted
   * secret fields keep their existing ciphertext.
   */
  buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Non-secret fields safe to return from admin list/get tools. */
  publicConfig(stored: Record<string, unknown>): Record<string, unknown>;

  /** Verify stored credentials against the vendor (read-only probe). */
  testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult>;
}

export type ConnectorDomain = 'commerce' | 'bookings';

export interface ConnectorConnectionContext {
  config: Record<string, unknown>;
  decryptSecret(ciphertext: string): Promise<string>;
}

export interface ConnectorConfigFieldInfo {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
}

export interface ConnectorTestResult {
  ok: boolean;
  detail: string;
}

export class ConnectorRegistry {
  private readonly byVendor = new Map<string, ConnectorAdapter>();

  constructor(adapters: ConnectorAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  /** Domain modules register their vendor adapters here at module init. */
  register(adapter: ConnectorAdapter): void {
    if (this.byVendor.has(adapter.vendor)) {
      throw new Error(`connector vendor already registered: ${adapter.vendor}`);
    }
    this.byVendor.set(adapter.vendor, adapter);
  }

  get(vendor: string): ConnectorAdapter | null {
    return this.byVendor.get(vendor) ?? null;
  }

  list(): ConnectorAdapter[] {
    return [...this.byVendor.values()];
  }

  listByDomain(domain: ConnectorDomain): ConnectorAdapter[] {
    return this.list().filter((a) => a.domain === domain);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

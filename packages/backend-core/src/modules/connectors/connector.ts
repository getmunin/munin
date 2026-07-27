import type { z } from 'zod';

export interface ConnectorAdapter {
  readonly vendor: string;
  readonly domain: ConnectorDomain;
  readonly displayName: string;
  readonly configInput: z.ZodType;
  readonly configFields: ConnectorConfigFieldInfo[];

  buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  publicConfig(stored: Record<string, unknown>): Record<string, unknown>;

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

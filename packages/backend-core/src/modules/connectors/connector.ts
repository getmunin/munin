import type { z } from 'zod';

export interface ConnectorAdapter {
  readonly vendor: string;
  readonly domain: ConnectorDomain;
  readonly displayName: string;
  readonly configInput: z.ZodType;
  readonly configFields: ConnectorConfigFieldInfo[];
  readonly oauth?: ConnectorOAuth;

  buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  publicConfig(stored: Record<string, unknown>): Record<string, unknown>;

  testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult>;
}

export type ConnectorDomain = 'commerce' | 'bookings' | 'seo';

export interface ConnectorConnectionContext {
  config: Record<string, unknown>;
  decryptSecret(ciphertext: string): Promise<string>;
  accessToken?: () => Promise<string>;
}

export interface ConnectorOAuth {
  readonly authorizationScopes: readonly string[];
  readonly clientIdKey: string;
  readonly encryptedClientSecretKey: string;

  authorizeUrl(args: { state: string; redirectUri: string; clientId: string }): string;

  exchangeCode(args: {
    code: string;
    redirectUri: string;
    client: OAuthClientCredentials;
  }): Promise<OAuthTokenSet>;

  refresh(args: { refreshToken: string; client: OAuthClientCredentials }): Promise<OAuthTokenSet>;

  revoke(args: { refreshToken: string; client: OAuthClientCredentials }): Promise<void>;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}

export class OAuthGrantRevokedError extends Error {}

export async function requireAccessToken(ctx: ConnectorConnectionContext): Promise<string> {
  if (!ctx.accessToken) {
    throw new Error('connector context carries no access token: adapter is not OAuth-backed');
  }
  return ctx.accessToken();
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

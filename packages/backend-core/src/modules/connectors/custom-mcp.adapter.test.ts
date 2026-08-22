import { describe, expect, it } from 'vitest';
import { CustomMcpAdapter, CustomMcpConfigInput } from './custom-mcp.adapter.ts';
import { ConnectorVendorError } from './http.ts';
import type { ConnectorConnectionContext } from './connector.ts';

const encrypt = (plaintext: string) => Promise.resolve(`enc(${plaintext})`);

function ctx(overrides: Partial<ConnectorConnectionContext> = {}): ConnectorConnectionContext {
  return {
    config: { url: 'https://crm.example.com/mcp', encryptedBearerToken: 'ct_abc' },
    decryptSecret: () => Promise.resolve('token_1234567890'),
    ...overrides,
  };
}

describe('CustomMcpConfigInput', () => {
  it('accepts an https endpoint and strips trailing slashes', () => {
    const parsed = CustomMcpConfigInput.parse({ url: 'https://crm.example.com/mcp/' });
    expect(parsed.url).toBe('https://crm.example.com/mcp');
  });

  it('rejects http endpoints', () => {
    expect(() => CustomMcpConfigInput.parse({ url: 'http://crm.example.com/mcp' })).toThrow();
  });

  it('rejects non-URL values', () => {
    expect(() => CustomMcpConfigInput.parse({ url: 'crm.example.com' })).toThrow();
  });
});

describe('CustomMcpAdapter', () => {
  it('encrypts the bearer token into stored config', async () => {
    const adapter = new CustomMcpAdapter();
    const stored = await adapter.buildStoredConfig(
      { url: 'https://crm.example.com/mcp', bearerToken: 'token_1234567890' },
      encrypt,
    );
    expect(stored).toEqual({
      url: 'https://crm.example.com/mcp',
      encryptedBearerToken: 'enc(token_1234567890)',
    });
  });

  it('keeps the previous encrypted token when config is updated without one', async () => {
    const adapter = new CustomMcpAdapter();
    const stored = await adapter.buildStoredConfig({ url: 'https://crm.example.com/mcp' }, encrypt, {
      url: 'https://old.example.com/mcp',
      encryptedBearerToken: 'ct_prev',
    });
    expect(stored.encryptedBearerToken).toBe('ct_prev');
  });

  it('refuses creation without a bearer token', async () => {
    const adapter = new CustomMcpAdapter();
    await expect(
      adapter.buildStoredConfig({ url: 'https://crm.example.com/mcp' }, encrypt),
    ).rejects.toThrow(ConnectorVendorError);
  });

  it('never exposes the encrypted token through publicConfig', () => {
    const adapter = new CustomMcpAdapter();
    expect(
      adapter.publicConfig({ url: 'https://crm.example.com/mcp', encryptedBearerToken: 'ct_abc' }),
    ).toEqual({ url: 'https://crm.example.com/mcp' });
  });

  it('probes the server with the decrypted token and reports the tool count', async () => {
    const seen: Array<{ url: string; bearerToken: string }> = [];
    const adapter = new CustomMcpAdapter((args) => {
      seen.push(args);
      return Promise.resolve({ tools: ['list_subscriptions', 'get_subscription'] });
    });
    const result = await adapter.testConnection(ctx());
    expect(seen).toEqual([
      { url: 'https://crm.example.com/mcp', bearerToken: 'token_1234567890' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('2 tool(s)');
    expect(result.detail).toContain('list_subscriptions');
  });

  it('propagates probe failures as vendor errors', async () => {
    const adapter = new CustomMcpAdapter(() =>
      Promise.reject(new ConnectorVendorError('MCP server unreachable: 401')),
    );
    await expect(adapter.testConnection(ctx())).rejects.toThrow('MCP server unreachable');
  });
});

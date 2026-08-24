import { describe, expect, it } from 'vitest';
import { CustomMcpAdapter, CustomMcpConfigInput } from './custom-mcp.adapter.ts';
import { ConnectorVendorError } from './http.ts';
import type { ConnectorConnectionContext } from './connector.ts';

const encrypt = (plaintext: string) => Promise.resolve(`enc(${plaintext})`);

function ctx(overrides: Partial<ConnectorConnectionContext> = {}): ConnectorConnectionContext {
  return {
    config: {
      url: 'https://crm.example.com/mcp',
      encryptedBearerToken: 'ct_abc',
      allowedTools: ['list_subscriptions'],
    },
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
      allowedTools: [],
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
      adapter.publicConfig({
        url: 'https://crm.example.com/mcp',
        encryptedBearerToken: 'ct_abc',
        allowedTools: ['list_subscriptions'],
      }),
    ).toEqual({ url: 'https://crm.example.com/mcp', allowedTools: ['list_subscriptions'] });
  });

  it('probes the server with the decrypted token and reports the tool count', async () => {
    const seen: Array<{ url: string; bearerToken: string }> = [];
    const adapter = new CustomMcpAdapter((args) => {
      seen.push(args);
      return Promise.resolve({
        tools: [
          { name: 'list_subscriptions', description: null, destructive: false },
          { name: 'get_subscription', description: null, destructive: false },
        ],
      });
    });
    const result = await adapter.testConnection(ctx());
    expect(seen).toEqual([
      { url: 'https://crm.example.com/mcp', bearerToken: 'token_1234567890' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('2 tool(s)');
    expect(result.detail).toContain('list_subscriptions');
  });

  it('spells out that nothing is exposed when no tool is allow-listed', async () => {
    const adapter = new CustomMcpAdapter(() =>
      Promise.resolve({
        tools: [
          { name: 'run_sql', description: null, destructive: true },
          { name: 'delete_repo', description: null, destructive: true },
        ],
      }),
    );
    const result = await adapter.testConnection(
      ctx({
        config: {
          url: 'https://crm.example.com/mcp',
          encryptedBearerToken: 'ct_abc',
          allowedTools: [],
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('0 exposed to customers');
    expect(result.detail).toContain('run_sql');
  });

  it('warns when an allow-listed tool is not read-only', async () => {
    const adapter = new CustomMcpAdapter(() =>
      Promise.resolve({
        tools: [
          { name: 'list_subscriptions', description: null, destructive: false },
          { name: 'cancel_subscription', description: null, destructive: true },
        ],
      }),
    );
    const result = await adapter.testConnection(
      ctx({
        config: {
          url: 'https://crm.example.com/mcp',
          encryptedBearerToken: 'ct_abc',
          allowedTools: ['list_subscriptions', 'cancel_subscription'],
        },
      }),
    );
    expect(result.detail).toContain('2 exposed to customers');
    expect(result.detail).toContain('warning: cancel_subscription');
  });

  it('flags allow-listed names the server does not actually offer', async () => {
    const adapter = new CustomMcpAdapter(() =>
      Promise.resolve({ tools: [{ name: 'list_subscriptions', description: null, destructive: false }] }),
    );
    const result = await adapter.testConnection(
      ctx({
        config: {
          url: 'https://crm.example.com/mcp',
          encryptedBearerToken: 'ct_abc',
          allowedTools: ['list_subscriptions', 'typo_tool'],
        },
      }),
    );
    expect(result.detail).toContain('allow-listed but missing from the server: typo_tool');
  });

  it('accepts a comma-separated allow-list from the dashboard form', async () => {
    const adapter = new CustomMcpAdapter();
    const stored = await adapter.buildStoredConfig(
      {
        url: 'https://crm.example.com/mcp',
        bearerToken: 'token_1234567890',
        allowedTools: 'list_subscriptions, get_subscription',
      },
      encrypt,
    );
    expect(stored.allowedTools).toEqual(['list_subscriptions', 'get_subscription']);
  });

  it('defaults the allow-list to empty when omitted', async () => {
    const adapter = new CustomMcpAdapter();
    const stored = await adapter.buildStoredConfig(
      { url: 'https://crm.example.com/mcp', bearerToken: 'token_1234567890' },
      encrypt,
    );
    expect(stored.allowedTools).toEqual([]);
  });

  it('lists the server tools with an allowed flag for the picker', async () => {
    const adapter = new CustomMcpAdapter(() =>
      Promise.resolve({
        tools: [
          { name: 'list_subscriptions', description: 'Their subscriptions', destructive: false },
          { name: 'run_sql', description: null, destructive: true },
        ],
      }),
    );
    const tools = await adapter.listSelectableTools(ctx());
    expect(tools).toEqual([
      {
        name: 'list_subscriptions',
        description: 'Their subscriptions',
        destructive: false,
        allowed: true,
      },
      { name: 'run_sql', description: null, destructive: true, allowed: false },
    ]);
  });

  it('replaces the allow-list, de-duplicating and keeping the rest of the config', () => {
    const adapter = new CustomMcpAdapter();
    const stored = adapter.applyAllowedTools(
      {
        url: 'https://crm.example.com/mcp',
        encryptedBearerToken: 'ct_abc',
        allowedTools: ['old_tool'],
      },
      ['a', 'b', 'a'],
    );
    expect(stored).toEqual({
      url: 'https://crm.example.com/mcp',
      encryptedBearerToken: 'ct_abc',
      allowedTools: ['a', 'b'],
    });
  });

  it('clears the allow-list when an empty selection is saved', () => {
    const adapter = new CustomMcpAdapter();
    const stored = adapter.applyAllowedTools(
      {
        url: 'https://crm.example.com/mcp',
        encryptedBearerToken: 'ct_abc',
        allowedTools: ['list_subscriptions'],
      },
      [],
    );
    expect(stored.allowedTools).toEqual([]);
  });

  it('propagates probe failures as vendor errors', async () => {
    const adapter = new CustomMcpAdapter(() =>
      Promise.reject(new ConnectorVendorError('MCP server unreachable: 401')),
    );
    await expect(adapter.testConnection(ctx())).rejects.toThrow('MCP server unreachable');
  });
});

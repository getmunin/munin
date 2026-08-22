import { z } from 'zod';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { safeFetchCompat, SsrfBlockedError } from '@getmunin/core';
import { stripTrailingSlashes } from '@getmunin/types';
import type {
  ConnectorAdapter,
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
} from './connector.ts';
import { ConnectorVendorError, REQUEST_TIMEOUT_MS } from './http.ts';

export const CUSTOM_MCP_VENDOR = 'custom-mcp';

export const CustomMcpConfigInput = z.object({
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), 'url must be https')
    .transform((u) => stripTrailingSlashes(u)),
  bearerToken: z.string().min(10).max(512).optional(),
});

const StoredCustomMcpConfig = z.object({
  url: z.string(),
  encryptedBearerToken: z.string(),
});

export type CustomMcpProbe = (args: {
  url: string;
  bearerToken: string;
}) => Promise<{ tools: string[] }>;

export async function probeCustomMcpServer(args: {
  url: string;
  bearerToken: string;
}): Promise<{ tools: string[] }> {
  const transport = new StreamableHTTPClientTransport(new URL(args.url), {
    fetch: safeFetchCompat,
    requestInit: {
      headers: { authorization: `Bearer ${args.bearerToken}` },
    },
  });
  const client = new Client(
    { name: 'munin-connector-probe', version: '0.0.1' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } },
  );
  try {
    await withDeadline(client.connect(transport), 'connect');
    const result = await withDeadline(client.listTools(), 'tools/list');
    return { tools: result.tools.map((t) => t.name) };
  } catch (err) {
    if (err instanceof SsrfBlockedError || err instanceof ConnectorVendorError) throw err;
    throw new ConnectorVendorError(
      `MCP server unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function withDeadline<T>(promise: Promise<T>, step: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ConnectorVendorError(`MCP ${step} timed out after ${REQUEST_TIMEOUT_MS}ms`)),
      REQUEST_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export class CustomMcpAdapter implements ConnectorAdapter {
  readonly vendor = CUSTOM_MCP_VENDOR;
  readonly domain = 'mcp' as const;
  readonly displayName = 'Custom MCP server';
  readonly configInput = CustomMcpConfigInput;
  readonly configFields: ConnectorConfigFieldInfo[] = [
    {
      key: 'url',
      label: 'MCP endpoint URL (streamable HTTP)',
      required: true,
      placeholder: 'https://api.example.com/mcp',
    },
    {
      key: 'bearerToken',
      label: 'Bearer token (minted in your system)',
      required: true,
      secret: true,
    },
  ];

  constructor(private readonly probe: CustomMcpProbe = probeCustomMcpServer) {}

  async buildStoredConfig(
    input: Record<string, unknown>,
    encryptSecret: (plaintext: string) => Promise<string>,
    previous?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = CustomMcpConfigInput.parse(input);
    const prev = previous ? StoredCustomMcpConfig.safeParse(previous) : null;
    const encryptedBearerToken = parsed.bearerToken
      ? await encryptSecret(parsed.bearerToken)
      : prev?.success
        ? prev.data.encryptedBearerToken
        : null;
    if (!encryptedBearerToken) {
      throw new ConnectorVendorError(
        'bearerToken is required when creating a custom MCP connection',
      );
    }
    return { url: parsed.url, encryptedBearerToken };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredCustomMcpConfig.parse(stored);
    return { url: parsed.url };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const config = StoredCustomMcpConfig.parse(ctx.config);
    const bearerToken = await ctx.decryptSecret(config.encryptedBearerToken);
    const { tools } = await this.probe({ url: config.url, bearerToken });
    const preview = tools.slice(0, 5).join(', ');
    return {
      ok: true,
      detail: `connected: ${tools.length} tool(s)${preview ? ` — ${preview}` : ''}${tools.length > 5 ? ', …' : ''}`,
    };
  }
}

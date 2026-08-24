import { z } from 'zod';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { parseEnvBool, safeFetchCompat, SsrfBlockedError } from '@getmunin/core';
import { stripTrailingSlashes } from '@getmunin/types';
import type {
  ConnectorAdapter,
  ConnectorConfigFieldInfo,
  ConnectorConnectionContext,
  ConnectorTestResult,
  SelectableTool,
  ToolCatalogAdapter,
} from './connector.ts';
import { ConnectorVendorError, REQUEST_TIMEOUT_MS } from './http.ts';

export const CUSTOM_MCP_VENDOR = 'custom-mcp';
export const MAX_EXPOSED_TOOLS = 20;

const AllowedTools = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return value;
  },
  z.array(z.string().trim().min(1).max(64)).max(MAX_EXPOSED_TOOLS).default([]),
);

export function allowsInsecureConnectorUrls(): boolean {
  return parseEnvBool({ name: 'MUNIN_SSRF_ALLOW_PRIVATE', default: false });
}

export const CustomMcpConfigInput = z.object({
  url: z
    .string()
    .trim()
    .url()
    .refine(
      (u) => u.startsWith('https://') || (u.startsWith('http://') && allowsInsecureConnectorUrls()),
      'url must be https (http is accepted only for local development, when MUNIN_SSRF_ALLOW_PRIVATE is set)',
    )
    .transform((u) => stripTrailingSlashes(u)),
  bearerToken: z.string().min(10).max(512).optional(),
  allowedTools: AllowedTools,
});

const StoredCustomMcpConfig = z.object({
  url: z.string(),
  encryptedBearerToken: z.string(),
  allowedTools: z.array(z.string()).default([]),
});

export interface DiscoveredTool {
  name: string;
  description: string | null;
  destructive: boolean;
}

export type CustomMcpProbe = (args: {
  url: string;
  bearerToken: string;
}) => Promise<{ tools: DiscoveredTool[] }>;

export async function probeCustomMcpServer(args: {
  url: string;
  bearerToken: string;
}): Promise<{ tools: DiscoveredTool[] }> {
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
    return { tools: result.tools.map(toDiscoveredTool) };
  } catch (err) {
    if (err instanceof SsrfBlockedError || err instanceof ConnectorVendorError) throw err;
    throw new ConnectorVendorError(
      `MCP server unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

function toDiscoveredTool(tool: {
  name: string;
  description?: string;
  annotations?: unknown;
}): DiscoveredTool {
  const annotations = tool.annotations as
    | { readOnlyHint?: unknown; destructiveHint?: unknown }
    | undefined;
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;
  return {
    name: tool.name,
    description: tool.description ?? null,
    destructive: destructive || !readOnly,
  };
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

export class CustomMcpAdapter implements ConnectorAdapter, ToolCatalogAdapter {
  readonly vendor = CUSTOM_MCP_VENDOR;
  readonly domain = 'mcp' as const;
  readonly displayName = 'Customer self-service MCP server';
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
    {
      key: 'allowedTools',
      label:
        'Tools your customers may use. Empty means none — this server stays connected but silent until you pick them.',
      required: false,
      placeholder: 'list_subscriptions, get_subscription',
      postConnect: true,
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
    return { url: parsed.url, encryptedBearerToken, allowedTools: parsed.allowedTools };
  }

  publicConfig(stored: Record<string, unknown>): Record<string, unknown> {
    const parsed = StoredCustomMcpConfig.parse(stored);
    return { url: parsed.url, allowedTools: parsed.allowedTools };
  }

  async testConnection(ctx: ConnectorConnectionContext): Promise<ConnectorTestResult> {
    const config = StoredCustomMcpConfig.parse(ctx.config);
    const bearerToken = await ctx.decryptSecret(config.encryptedBearerToken);
    const { tools } = await this.probe({ url: config.url, bearerToken });
    return { ok: true, detail: describeExposure(tools, config.allowedTools) };
  }

  async listSelectableTools(ctx: ConnectorConnectionContext): Promise<SelectableTool[]> {
    const config = StoredCustomMcpConfig.parse(ctx.config);
    const bearerToken = await ctx.decryptSecret(config.encryptedBearerToken);
    const { tools } = await this.probe({ url: config.url, bearerToken });
    const allowed = new Set(config.allowedTools);
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      destructive: tool.destructive,
      allowed: allowed.has(tool.name),
    }));
  }

  applyAllowedTools(
    stored: Record<string, unknown>,
    toolNames: readonly string[],
  ): Record<string, unknown> {
    const config = StoredCustomMcpConfig.parse(stored);
    return { ...config, allowedTools: [...new Set(toolNames)].slice(0, MAX_EXPOSED_TOOLS) };
  }
}

export function describeExposure(
  discovered: DiscoveredTool[],
  allowedTools: readonly string[],
): string {
  const allowed = new Set(allowedTools);
  const exposed = discovered.filter((t) => allowed.has(t.name));
  const unknown = allowedTools.filter((name) => !discovered.some((t) => t.name === name));
  const parts = [`connected: ${discovered.length} tool(s) offered by the server`];

  if (exposed.length === 0) {
    parts.push(
      `0 exposed to customers — nothing from this server reaches a conversation until you list tool names in allowedTools. Available: ${
        discovered.map((t) => t.name).join(', ') || '(none)'
      }`,
    );
  } else {
    const writes = exposed.filter((t) => t.destructive).map((t) => t.name);
    parts.push(`${exposed.length} exposed to customers: ${exposed.map((t) => t.name).join(', ')}`);
    const notExposed = discovered.filter((t) => !allowed.has(t.name)).map((t) => t.name);
    if (notExposed.length > 0) parts.push(`not exposed: ${notExposed.join(', ')}`);
    if (writes.length > 0) {
      parts.push(
        `warning: ${writes.join(', ')} ${writes.length === 1 ? 'is' : 'are'} not marked read-only, so an exposed tool can change data on your side when a customer asks`,
      );
    }
  }
  if (unknown.length > 0) {
    parts.push(`allow-listed but missing from the server: ${unknown.join(', ')}`);
  }
  return parts.join('. ');
}

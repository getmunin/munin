import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpTool, McpToolHandle, McpToolResult } from './types.ts';
import { stripTrailingSlashes } from '@getmunin/types';

export type HttpMcpFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenHttpMcpClientOptions {
  baseUrl?: string;
  url?: string;
  bearerToken: string;
  clientName?: string;
  headers?: Record<string, string>;
  fetchImpl?: HttpMcpFetch;
}

export interface OpenedHttpMcpClient extends McpToolHandle {
  close(): Promise<void>;
}

export async function openHttpMcpClient(opts: OpenHttpMcpClientOptions): Promise<OpenedHttpMcpClient> {
  const endpoint = opts.url ?? (opts.baseUrl ? `${stripTrailingSlashes(opts.baseUrl)}/mcp` : null);
  if (!endpoint) throw new Error('openHttpMcpClient requires url or baseUrl');
  const url = new URL(endpoint);
  const transport = new StreamableHTTPClientTransport(url, {
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
    requestInit: {
      headers: {
        authorization: `Bearer ${opts.bearerToken}`,
        ...(opts.headers ?? {}),
      },
    },
  });
  const client = new Client(
    { name: opts.clientName ?? 'munin-agent', version: '0.0.1' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(transport);

  return {
    async listTools(): Promise<McpTool[]> {
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }));
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      const result = await client.callTool({ name, arguments: args });
      return {
        content: result.content ?? [],
        isError: typeof result.isError === 'boolean' ? result.isError : undefined,
      };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpTool, McpToolHandle, McpToolResult } from './types.js';

export interface OpenMcpClientOptions {
  baseUrl: string;
  bearerToken: string;
  clientName?: string;
}

export interface OpenedMcpClient extends McpToolHandle {
  close(): Promise<void>;
}

export async function openMcpClient(opts: OpenMcpClientOptions): Promise<OpenedMcpClient> {
  const url = new URL(`${opts.baseUrl.replace(/\/+$/, '')}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        authorization: `Bearer ${opts.bearerToken}`,
      },
    },
  });
  const client = new Client(
    { name: opts.clientName ?? 'munin-self-service-ai', version: '0.0.1' },
    { capabilities: {} },
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
        content: (result.content ?? []) as McpToolResult['content'],
        isError: typeof result.isError === 'boolean' ? result.isError : undefined,
      };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

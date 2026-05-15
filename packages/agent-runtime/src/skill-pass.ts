import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { assistantNamePreamble } from './conversation-handler.js';
import { runAgent } from './runtime.js';
import type { McpTool, McpToolHandle, McpToolResult, Provider } from './types.js';

export interface SkillPassOptions {
  baseUrl: string;
  adminApiKey: string;
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  skillUri: string;
  userPrompt: string;
  assistantName?: string | null;
  maxToolIterations?: number;
  maxHistoryChars?: number;
  clientName?: string;
  providerImpl?: Provider;
  allowedToolPrefixes?: string[];
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export type SkillPassResult =
  | {
      ok: true;
      toolCalls: number;
      totalTokens: number;
      finishReason: 'stop' | 'length' | 'tool_iteration_limit' | 'error';
      replyText: string;
    }
  | {
      ok: false;
      skipped:
        | 'no_admin_key'
        | 'no_provider_key'
        | 'skill_missing'
        | 'mcp_connect_failed'
        | 'agent_error';
      error?: string;
    };

export async function runSkillPass(opts: SkillPassOptions): Promise<SkillPassResult> {
  const log =
    opts.logger ??
    {
      info: (m: string) => console.log(`[skill-pass] ${m}`),
      warn: (m: string) => console.warn(`[skill-pass] ${m}`),
      error: (m: string) => console.error(`[skill-pass] ${m}`),
    };

  if (!opts.adminApiKey) return { ok: false, skipped: 'no_admin_key' };
  if (!opts.providerApiKey) return { ok: false, skipped: 'no_provider_key' };

  const url = new URL(`${opts.baseUrl.replace(/\/+$/, '')}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${opts.adminApiKey}` } },
  });
  const client = new Client(
    { name: opts.clientName ?? 'munin-skill-pass', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
  } catch (err) {
    log.warn(`mcp connect failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, skipped: 'mcp_connect_failed' };
  }

  try {
    const skill = await readSkillFromClient(client, opts.skillUri);
    if (!skill) {
      log.warn(`${opts.skillUri} not available on ${opts.baseUrl}`);
      return { ok: false, skipped: 'skill_missing' };
    }
    const baseHandle = adaptToToolHandle(client);
    const mcp = opts.allowedToolPrefixes
      ? withAllowedToolPrefixes(baseHandle, opts.allowedToolPrefixes)
      : baseHandle;
    try {
      const reply = await runAgent({
        config: {
          provider: { baseUrl: opts.providerBaseUrl, apiKey: opts.providerApiKey },
          model: opts.model,
          systemPrompt: assistantNamePreamble(opts.assistantName) + skill,
          maxToolIterations: opts.maxToolIterations ?? 24,
          maxHistoryChars: opts.maxHistoryChars ?? 32_000,
        },
        history: [
          {
            authorType: 'user',
            body: opts.userPrompt,
            createdAt: new Date().toISOString(),
          },
        ],
        mcp,
        provider: opts.providerImpl,
      });
      return {
        ok: true,
        toolCalls: reply.toolCalls.length,
        totalTokens: reply.usage.totalTokens,
        finishReason: reply.finishReason,
        replyText: reply.body,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`runAgent failed: ${message}`);
      return { ok: false, skipped: 'agent_error', error: message };
    }
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

async function readSkillFromClient(client: Client, uri: string): Promise<string | null> {
  try {
    const res = await client.readResource({ uri });
    const item = res.contents[0];
    if (!item) return null;
    if ('text' in item && typeof item.text === 'string') return item.text;
    return null;
  } catch {
    return null;
  }
}

function adaptToToolHandle(client: Client): McpToolHandle {
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
  };
}

export function withAllowedToolPrefixes(
  handle: McpToolHandle,
  allowedPrefixes: readonly string[],
): McpToolHandle {
  if (allowedPrefixes.length === 0) return handle;
  const isAllowed = (name: string): boolean =>
    allowedPrefixes.some((prefix) => name.startsWith(prefix));
  return {
    async listTools(): Promise<McpTool[]> {
      const tools = await handle.listTools();
      return tools.filter((t) => isAllowed(t.name));
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      if (!isAllowed(name)) {
        return {
          content: [
            {
              type: 'text',
              text: `tool '${name}' is not in the allow-list for this skill pass`,
            },
          ],
          isError: true,
        };
      }
      return handle.callTool(name, args);
    },
  };
}

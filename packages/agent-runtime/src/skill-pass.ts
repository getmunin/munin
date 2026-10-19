import { redactQueryParams } from '@getmunin/core';
import type { PinnedToolArgs } from '@getmunin/types';
import { assistantNamePreamble } from './conversation-handler.ts';
import { classifyProviderError, type ProviderErrorCode } from './providers/transport.ts';
import { runAgent } from './runtime.ts';
import type {
  ConversationAttachment,
  McpTool,
  McpToolHandle,
  McpToolResult,
  Provider,
} from './types.ts';

export interface SkillReader {
  readSkill(uri: string): Promise<string | null>;
}

export interface SkillPassOptions {
  mcp: McpToolHandle;
  skills: SkillReader;
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  skillUri: string;
  userPrompt: string;
  userPromptAttachments?: ConversationAttachment[];
  assistantName?: string | null;
  maxToolIterations?: number;
  maxHistoryChars?: number;
  providerImpl?: Provider;
  allowedTools?: readonly string[];
  pinnedArgs?: PinnedToolArgs;
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
        | 'no_tool_allowlist'
        | 'unbound_job_payload'
        | 'mcp_connect_failed'
        | 'agent_error'
        | 'provider_error'
        | 'quota_exceeded';
      error?: string;
      code?: ProviderErrorCode;
      failedStep?: string;
    };

export async function runSkillPass(opts: SkillPassOptions): Promise<SkillPassResult> {
  const log =
    opts.logger ??
    {
      info: (m: string) => console.log(`[skill-pass] ${redactQueryParams(m)}`),
      warn: (m: string) => console.warn(`[skill-pass] ${redactQueryParams(m)}`),
      error: (m: string) => console.error(`[skill-pass] ${redactQueryParams(m)}`),
    };

  if (!opts.providerApiKey) return { ok: false, skipped: 'no_provider_key' };

  let skill: string | null;
  try {
    skill = await opts.skills.readSkill(opts.skillUri);
  } catch (err) {
    log.warn(`readSkill failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, skipped: 'skill_missing' };
  }
  if (!skill) {
    log.warn(`${opts.skillUri} not available`);
    return { ok: false, skipped: 'skill_missing' };
  }

  if (!opts.allowedTools || opts.allowedTools.length === 0) {
    log.warn(`${opts.skillUri} has no tool allow-list; refusing to run it with the full tool surface`);
    return { ok: false, skipped: 'no_tool_allowlist' };
  }
  const allowed = withAllowedTools(opts.mcp, opts.allowedTools);
  const mcp = opts.pinnedArgs ? withPinnedArgs(allowed, opts.pinnedArgs) : allowed;

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
          ...(opts.userPromptAttachments?.length
            ? { attachments: opts.userPromptAttachments }
            : {}),
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
    const classified = classifyProviderError(err);
    log.error(`runAgent failed: ${classified.message}`);
    if (classified.status !== undefined) {
      return {
        ok: false,
        skipped: 'provider_error',
        code: classified.code,
        error: classified.message,
        failedStep: 'run_agent',
      };
    }
    return { ok: false, skipped: 'agent_error', error: classified.message };
  }
}

export function withAllowedTools(
  handle: McpToolHandle,
  allowedTools: readonly string[],
): McpToolHandle {
  const allowed = new Set(allowedTools);
  const isAllowed = (name: string): boolean => allowed.has(name);
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

export function withPinnedArgs(handle: McpToolHandle, pinned: PinnedToolArgs): McpToolHandle {
  return {
    listTools: () => handle.listTools(),
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      const fixed = Object.hasOwn(pinned, name) ? pinned[name] : undefined;
      for (const [key, value] of Object.entries(fixed ?? {})) {
        if (args[key] !== value) {
          return {
            content: [
              {
                type: 'text',
                text: `argument '${key}' of tool '${name}' is fixed to '${value}' for this skill pass`,
              },
            ],
            isError: true,
          };
        }
      }
      return handle.callTool(name, args);
    },
  };
}

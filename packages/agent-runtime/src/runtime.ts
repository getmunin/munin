import { flattenToolResult, mcpToolsToChatTools } from './mcp-tool-translation.js';
import { openAiCompatibleProvider } from './providers/openai-compatible.js';
import type {
  AgentConfig,
  AgentReply,
  ChatMessage,
  ConversationMessage,
  McpToolHandle,
  Provider,
  ProviderUsage,
  ToolCallTrace,
} from './types.js';

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

export interface RunAgentArgs {
  config: AgentConfig;
  history: ConversationMessage[];
  mcp: McpToolHandle;
  abortSignal?: AbortSignal;
  /** Override provider — used by tests. Defaults to OpenAI-compatible. */
  provider?: Provider;
}

export async function runAgent({
  config,
  history,
  mcp,
  abortSignal,
  provider = openAiCompatibleProvider,
}: RunAgentArgs): Promise<AgentReply> {
  const tools = mcpToolsToChatTools(await mcp.listTools());
  const messages: ChatMessage[] = [
    { role: 'system', content: config.systemPrompt },
    ...history.map(historyToChatMessage),
  ];

  const toolCalls: ToolCallTrace[] = [];
  const usageTotal = { prompt: 0, completion: 0, total: 0 };
  const maxIterations = config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (abortSignal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }

    const response = await provider({ config, messages, tools, abortSignal });
    accumulateUsage(usageTotal, response.usage);

    if (response.finishReason === 'tool_calls' && response.message.tool_calls?.length) {
      messages.push(response.message);
      for (const call of response.message.tool_calls) {
        if (abortSignal?.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        const args = parseArgs(call.function.arguments);
        const result = await mcp.callTool(call.function.name, args);
        toolCalls.push({ name: call.function.name, args, result });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: flattenToolResult(result),
        });
      }
      continue;
    }

    return {
      body: response.message.content ?? '',
      usage: {
        promptTokens: usageTotal.prompt,
        completionTokens: usageTotal.completion,
        totalTokens: usageTotal.total,
      },
      model: config.model,
      finishReason: response.finishReason === 'stop' ? 'stop' : response.finishReason === 'length' ? 'length' : 'error',
      toolCalls,
    };
  }

  return {
    body: '',
    usage: {
      promptTokens: usageTotal.prompt,
      completionTokens: usageTotal.completion,
      totalTokens: usageTotal.total,
    },
    model: config.model,
    finishReason: 'tool_iteration_limit',
    toolCalls,
  };
}

function historyToChatMessage(msg: ConversationMessage): ChatMessage {
  switch (msg.authorType) {
    case 'user':
    case 'end_user':
      return { role: 'user', content: msg.body };
    case 'agent':
      return { role: 'assistant', content: msg.body };
    case 'staff':
      return { role: 'user', name: 'staff', content: `[staff message] ${msg.body}` };
    case 'system':
      return { role: 'system', content: msg.body };
    default:
      return { role: 'user', content: msg.body };
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function accumulateUsage(
  totals: { prompt: number; completion: number; total: number },
  usage?: ProviderUsage,
): void {
  if (!usage) return;
  totals.prompt += usage.prompt_tokens ?? 0;
  totals.completion += usage.completion_tokens ?? 0;
  totals.total += usage.total_tokens ?? 0;
}

import { stripTrailingSlashes } from '@getmunin/types';
import { postJsonWithRateLimitRetry, ProviderError, throwProviderError } from './transport.ts';
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  Provider,
  ProviderResponse,
  ProviderUsage,
} from '../types.ts';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;
const HISTORY_START_MARKER = '[Conversation history begins.]';

const CACHE_TURN = { type: 'ephemeral' } as const;
const CACHE_PREFIX = { type: 'ephemeral', ttl: '1h' } as const;

type CacheControl = typeof CACHE_TURN | typeof CACHE_PREFIX;

interface NativeTextBlock {
  type: 'text';
  text: string;
}

interface NativeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface NativeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface NativeMessage {
  role: 'user' | 'assistant';
  content: unknown[];
}

interface NativeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface NativeResponse {
  content?: unknown[];
  stop_reason?: string;
  usage?: NativeUsage;
}

export function isAnthropicNativeBaseUrl(baseUrl: string): boolean {
  return /api\.anthropic\.com/i.test(baseUrl);
}

export const anthropicNativeProvider: Provider = async ({
  config,
  messages,
  tools,
  abortSignal,
}) => {
  const url = `${stripTrailingSlashes(config.provider.baseUrl)}/messages`;
  const cacheEnabled = config.enablePromptCache !== false;

  const system = toNativeSystem(messages, cacheEnabled);
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toNativeMessages(messages, cacheEnabled),
  };
  if (system.length > 0) body.system = system;
  if (tools.length > 0) body.tools = toNativeTools(tools, cacheEnabled);
  if (typeof config.temperature === 'number') body.temperature = config.temperature;

  const res = await postJsonWithRateLimitRetry({
    url,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.provider.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    abortSignal,
  });
  if (!res.ok) await throwProviderError(res);

  const json = (await res.json()) as NativeResponse;
  const content = Array.isArray(json.content) ? json.content : [];
  if (content.length === 0 && !json.stop_reason) {
    throw new ProviderError('provider returned no content', 0);
  }

  const { text, toolCalls } = fromNativeContent(content);
  const message: ChatMessage = {
    role: 'assistant',
    content: text.length > 0 ? text : null,
    providerContentBlocks: content,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    message,
    usage: toProviderUsage(json.usage),
    finishReason: toFinishReason(json.stop_reason, toolCalls.length),
  };
};

export function toNativeSystem(messages: ChatMessage[], cacheEnabled = true): unknown[] {
  const blocks: unknown[] = [];
  let lastStable = -1;
  for (const m of messages) {
    if (m.role !== 'system') continue;
    if (typeof m.content !== 'string' || m.content.length === 0) continue;
    if (!m.volatile) lastStable = blocks.length;
    const block: NativeTextBlock = { type: 'text', text: m.content };
    blocks.push(block);
  }
  if (!cacheEnabled || lastStable < 0) return blocks;
  return markAt(blocks, lastStable, CACHE_PREFIX);
}

export function toNativeTools(tools: ChatToolDefinition[], cacheEnabled = true): unknown[] {
  const mapped: unknown[] = tools.map((tool) => {
    const spec: Record<string, unknown> = {
      name: tool.function.name,
      input_schema: tool.function.parameters,
    };
    if (tool.function.description) spec.description = tool.function.description;
    return spec;
  });
  return cacheEnabled ? markLast(mapped, CACHE_PREFIX) : mapped;
}

export function toNativeMessages(
  messages: ChatMessage[],
  cacheEnabled = true,
): NativeMessage[] {
  const out: NativeMessage[] = [];
  let openToolResults: NativeMessage | null = null;

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const block: NativeToolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id ?? '',
        content: m.content ?? '',
      };
      if (openToolResults) {
        openToolResults.content.push(block);
      } else {
        openToolResults = { role: 'user', content: [block] };
        out.push(openToolResults);
      }
      continue;
    }

    openToolResults = null;

    if (m.role === 'assistant') {
      const content = assistantContent(m);
      if (content.length > 0) out.push({ role: 'assistant', content });
      continue;
    }

    if (typeof m.content === 'string' && m.content.length > 0) {
      const block: NativeTextBlock = { type: 'text', text: m.content };
      out.push({ role: 'user', content: [block] });
    }
  }

  if (out.length === 0 || out[0]?.role !== 'user') {
    const block: NativeTextBlock = { type: 'text', text: HISTORY_START_MARKER };
    out.unshift({ role: 'user', content: [block] });
  }

  if (!cacheEnabled) return out;

  const last = out[out.length - 1];
  if (!last) return out;
  return [
    ...out.slice(0, -1),
    { ...last, content: markLastContentBlock(last.content, CACHE_TURN) },
  ];
}

function assistantContent(m: ChatMessage): unknown[] {
  if (m.providerContentBlocks && m.providerContentBlocks.length > 0) {
    return m.providerContentBlocks;
  }
  const content: unknown[] = [];
  if (typeof m.content === 'string' && m.content.length > 0) {
    const block: NativeTextBlock = { type: 'text', text: m.content };
    content.push(block);
  }
  for (const call of m.tool_calls ?? []) {
    const block: NativeToolUseBlock = {
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parseToolArguments(call.function.arguments),
    };
    content.push(block);
  }
  return content;
}

export function fromNativeContent(content: unknown[]): {
  text: string;
  toolCalls: ChatToolCall[];
} {
  const textParts: string[] = [];
  const toolCalls: ChatToolCall[] = [];

  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      textParts.push(block.text);
      continue;
    }
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(
            block.input && typeof block.input === 'object' ? block.input : {},
          ),
        },
      });
    }
  }

  return { text: textParts.join('\n'), toolCalls };
}

export function toProviderUsage(usage: NativeUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = (usage.input_tokens ?? 0) + cacheRead + cacheWrite;
  const completionTokens = usage.output_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  };
}

function toFinishReason(
  stopReason: string | undefined,
  toolCallCount: number,
): ProviderResponse['finishReason'] {
  switch (stopReason) {
    case 'tool_use':
      return 'tool_calls';
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    default:
      return toolCallCount > 0 ? 'tool_calls' : 'error';
  }
}

function parseToolArguments(raw: string): Record<string, unknown> {
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

function markLast(blocks: unknown[], cacheControl: CacheControl): unknown[] {
  if (blocks.length === 0) return blocks;
  return markAt(blocks, blocks.length - 1, cacheControl);
}

function markAt(blocks: unknown[], index: number, cacheControl: CacheControl): unknown[] {
  const target = blocks[index];
  if (!target || typeof target !== 'object') return blocks;
  return blocks.map((block, i) =>
    i === index ? { ...target, cache_control: cacheControl } : block,
  );
}

const CACHEABLE_BLOCK_TYPES = new Set(['text', 'tool_result']);

function markLastContentBlock(blocks: unknown[], cacheControl: CacheControl): unknown[] {
  const last = blocks[blocks.length - 1];
  if (!last || typeof last !== 'object') return blocks;
  const type = (last as { type?: unknown }).type;
  if (typeof type !== 'string' || !CACHEABLE_BLOCK_TYPES.has(type)) return blocks;
  return markLast(blocks, cacheControl);
}

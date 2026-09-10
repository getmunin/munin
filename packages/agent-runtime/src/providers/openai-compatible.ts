import { postJsonWithRateLimitRetry, ProviderError, throwProviderError } from './transport.ts';
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  Provider,
  ProviderResponse,
} from '../types.ts';
import { stripTrailingSlashes } from '@getmunin/types';

interface OpenAIChoice {
  message: ChatMessage;
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const CACHE_CONTROL = { type: 'ephemeral' } as const;

export interface OutboundMessage {
  role: ChatMessage['role'];
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  providerContentBlocks?: unknown[];
  volatile?: boolean;
}

export const openAiCompatibleProvider: Provider = async ({
  config,
  messages,
  tools,
  abortSignal,
}) => {
  const url = `${stripTrailingSlashes(config.provider.baseUrl)}/chat/completions`;
  const cacheEnabled = shouldEnablePromptCache(config);
  const outbound = toOpenAiMessages(messages);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: cacheEnabled ? withSystemPromptCache(outbound) : outbound,
  };
  if (tools.length > 0) {
    body.tools = cacheEnabled ? withToolsCache(tools) : tools;
    body.tool_choice = 'auto';
  }
  if (typeof config.maxTokens === 'number') body.max_tokens = config.maxTokens;
  if (typeof config.temperature === 'number') body.temperature = config.temperature;
  if (config.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const res = await postJsonWithRateLimitRetry({
    url,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.provider.apiKey}`,
    },
    body: JSON.stringify(body),
    abortSignal,
  });
  if (!res.ok) await throwProviderError(res);

  const json = (await res.json()) as OpenAIResponse;
  const choice = json.choices[0];
  if (!choice) {
    throw new ProviderError('provider returned no choices', 0);
  }

  const finishReason: ProviderResponse['finishReason'] =
    choice.finish_reason === 'tool_calls'
      ? 'tool_calls'
      : choice.finish_reason === 'length'
        ? 'length'
        : choice.finish_reason === 'stop'
          ? 'stop'
          : 'error';

  return {
    message: choice.message,
    usage: json.usage,
    finishReason,
  };
};

export function shouldEnablePromptCache(config: {
  provider: { baseUrl: string };
  model: string;
  enablePromptCache?: boolean;
}): boolean {
  if (config.enablePromptCache === false) return false;
  if (config.enablePromptCache === true) return true;
  return isAnthropicCompatibleBackend(config.provider.baseUrl, config.model);
}

function isAnthropicCompatibleBackend(baseUrl: string, model: string): boolean {
  return /openrouter\.ai/i.test(baseUrl) && /^anthropic\//i.test(model);
}

export function toOpenAiMessages(messages: readonly ChatMessage[]): OutboundMessage[] {
  return messages.map((m) => {
    const { images, ...rest } = m;
    if (m.role !== 'user' || !images || images.length === 0) return rest;
    const parts: unknown[] = images.map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    }));
    if (typeof m.content === 'string' && m.content.length > 0) {
      parts.push({ type: 'text', text: m.content });
    }
    return { ...rest, content: parts };
  });
}

export function withSystemPromptCache(messages: readonly OutboundMessage[]): unknown[] {
  let firstSystemMarked = false;
  return messages.map((m) => {
    if (m.role !== 'system' || firstSystemMarked) return m;
    if (typeof m.content !== 'string' || m.content.length === 0) return m;
    firstSystemMarked = true;
    return {
      ...m,
      content: [{ type: 'text', text: m.content, cache_control: CACHE_CONTROL }],
    };
  });
}

export function withToolsCache(tools: ChatToolDefinition[]): unknown[] {
  if (tools.length === 0) return tools;
  return tools.map((tool, idx) =>
    idx === tools.length - 1 ? { ...tool, cache_control: CACHE_CONTROL } : tool,
  );
}

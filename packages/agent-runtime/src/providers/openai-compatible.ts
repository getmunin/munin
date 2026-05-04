import type { ChatMessage, Provider, ProviderResponse } from '../types.js';

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

export const openAiCompatibleProvider: Provider = async ({
  config,
  messages,
  tools,
  abortSignal,
}) => {
  const url = `${config.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (typeof config.maxTokens === 'number') body.max_tokens = config.maxTokens;
  if (typeof config.temperature === 'number') body.temperature = config.temperature;
  if (config.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: abortSignal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `provider returned ${res.status}: ${text.slice(0, 500)}`,
      res.status,
    );
  }

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

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

import { anthropicNativeProvider, isAnthropicNativeBaseUrl } from './anthropic-native.ts';
import { openAiCompatibleProvider } from './openai-compatible.ts';
import type { Provider } from '../types.ts';

export function selectProvider(baseUrl: string): Provider {
  return isAnthropicNativeBaseUrl(baseUrl) ? anthropicNativeProvider : openAiCompatibleProvider;
}

export const defaultProvider: Provider = (args) =>
  selectProvider(args.config.provider.baseUrl)(args);

import type { Provider } from '@getmunin/agent-runtime';

export function createMeteringProvider(
  base: Provider,
  onTokens: (totalTokens: number) => void,
): Provider {
  return async (args) => {
    const response = await base(args);
    const total = response.usage?.total_tokens ?? 0;
    if (total > 0) onTokens(total);
    return response;
  };
}

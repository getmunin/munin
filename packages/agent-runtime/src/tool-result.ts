import type { McpToolResult, ToolCallTrace } from './types.ts';

export function resultJson(result: McpToolResult): unknown {
  for (const item of result.content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      try {
        return JSON.parse(item.text);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function lastSuccessfulCall(
  toolCalls: ToolCallTrace[],
  name: string,
): ToolCallTrace | undefined {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const call = toolCalls[i];
    if (call && call.name === name && !call.result.isError) return call;
  }
  return undefined;
}

export function successfulCalls(toolCalls: ToolCallTrace[], name: string): ToolCallTrace[] {
  return toolCalls.filter((call) => call.name === name && !call.result.isError);
}

import type { ChatToolDefinition, McpTool } from './types.ts';

export function mcpToolsToChatTools(tools: McpTool[]): ChatToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeSchema(tool.inputSchema),
    },
  }));
}

function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema && typeof schema === 'object' && 'type' in schema) return schema;
  return { type: 'object', properties: {}, additionalProperties: true };
}

export function flattenToolResult(result: { content: Array<{ type: string; text?: string; [k: string]: unknown }> }): string {
  const parts: string[] = [];
  for (const item of result.content) {
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else parts.push(JSON.stringify(item));
  }
  return parts.join('\n');
}

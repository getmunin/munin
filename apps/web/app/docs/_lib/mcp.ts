import mcpFixture from '../../../../../packages/backend-core/docs-fixtures/mcp-tools.json';

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  audiences: readonly string[];
  scopes: readonly string[];
  danger: 'destructive' | 'writes' | null;
  readOnly: boolean;
  inputSchema: { type?: string; properties?: Record<string, McpSchema>; required?: string[] };
}

export interface McpSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: McpSchema;
  properties?: Record<string, McpSchema>;
  required?: string[];
}

export const mcpTools = mcpFixture as unknown as McpTool[];

export function listAdmin(): McpTool[] {
  return mcpTools.filter((t) => t.audiences.includes('admin'));
}

export function listSelfService(): McpTool[] {
  return mcpTools.filter((t) => t.audiences.includes('self_service'));
}

export function findTool(name: string): McpTool | undefined {
  return mcpTools.find((t) => t.name === name);
}

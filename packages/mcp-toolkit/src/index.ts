// MCP toolkit:
//   - @McpTool decorator (with audiences metadata)
//   - Streamable HTTP transport adapter for NestJS
//   - Zod → MCP JSON Schema bridge
//   - Auth + scope + audience + audit middleware
//   - tools/list filtering by audience and scope
//
// Implementation lands in M0.4.

export type Audience = 'admin' | 'self_service';

export interface McpToolMeta {
  name: string;
  description: string;
  audiences: Audience[];
  scopes: string[];
}

export const PLACEHOLDER = 'to be implemented in M0.4';

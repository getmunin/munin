import 'reflect-metadata';
import type { z } from 'zod';
import type { Audience } from '@getmunin/core';

/**
 * Metadata captured by the @McpTool() decorator.
 *
 * - `audiences` controls which token types can see/call this tool. Self-service
 *   tokens never see admin-only tools (filtered from tools/list).
 * - `scopes` is checked at call time; missing scopes return an error.
 * - `input` is a Zod schema; converted to JSON Schema for tools/list and used
 *   for runtime validation on tools/call.
 */
export interface McpToolMeta<TInput extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  audiences: readonly Audience[];
  scopes: readonly string[];
  input: TInput;
}

export const MCP_TOOL_META = Symbol.for('munin.mcp.tool.meta');

/**
 * Decorator marking a method as an MCP tool. The runtime registry
 * (M0.5+) uses NestJS DiscoveryService to find every method carrying
 * this metadata and registers it as a callable MCP tool.
 *
 * Usage:
 * ```ts
 *   @McpTool({
 *     name: 'kb_search',
 *     description: 'Search knowledge base documents',
 *     audiences: ['admin', 'self_service'],
 *     scopes: ['kb:read'],
 *     input: z.object({ query: z.string() }),
 *   })
 *   async search(args: { query: string }) { ... }
 * ```
 */
export function McpTool<T extends z.ZodObject>(meta: McpToolMeta<T>) {
  return function (target: object, propertyKey: string | symbol): void {
    Reflect.defineMetadata(MCP_TOOL_META, meta, target, propertyKey);
  };
}

/** Read the metadata stored by @McpTool, if any. */
export function getMcpToolMeta(target: object, propertyKey: string | symbol): McpToolMeta | undefined {
  return Reflect.getMetadata(MCP_TOOL_META, target, propertyKey) as McpToolMeta | undefined;
}

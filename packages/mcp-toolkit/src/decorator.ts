import 'reflect-metadata';
import type { z } from 'zod';
import type { Audience } from '@getmunin/core';

export interface McpToolMeta<TInput extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  audiences: readonly Audience[];
  scopes: readonly string[];
  input: TInput;
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  _meta?: Record<string, unknown>;
}

export const MCP_TOOL_META = Symbol.for('munin.mcp.tool.meta');

export function McpTool<T extends z.ZodObject>(meta: McpToolMeta<T>) {
  return function (target: object, propertyKey: string | symbol): void {
    Reflect.defineMetadata(MCP_TOOL_META, meta, target, propertyKey);
  };
}

export function getMcpToolMeta(target: object, propertyKey: string | symbol): McpToolMeta | undefined {
  return Reflect.getMetadata(MCP_TOOL_META, target, propertyKey) as McpToolMeta | undefined;
}

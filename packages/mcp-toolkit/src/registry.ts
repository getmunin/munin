import { z } from 'zod';
import type { Audience } from '@getmunin/core';
import type { McpToolMeta } from './decorator.ts';
import type { JsonSchemaObject } from './dispatch.ts';

export interface RegisteredMcpTool {
  meta: McpToolMeta;
  handler: (args: unknown) => unknown;
  inputJsonSchema: JsonSchemaObject;
}

export class McpToolRegistry {
  private readonly byName = new Map<string, RegisteredMcpTool>();

  register(meta: McpToolMeta, handler: RegisteredMcpTool['handler']): void {
    if (this.byName.has(meta.name)) {
      throw new Error(`Duplicate MCP tool name: ${meta.name}`);
    }
    const inputJsonSchema = z.toJSONSchema(meta.input) as JsonSchemaObject;
    this.byName.set(meta.name, { meta, handler, inputJsonSchema });
  }

  list(audience?: Audience): RegisteredMcpTool[] {
    const all = Array.from(this.byName.values());
    if (!audience) return all;
    return all.filter((t) => t.meta.audiences.includes(audience));
  }

  get(name: string): RegisteredMcpTool | undefined {
    return this.byName.get(name);
  }

  size(): number {
    return this.byName.size;
  }
}

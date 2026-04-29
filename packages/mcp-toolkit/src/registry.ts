import { z } from 'zod';
import type { Audience } from '@getmunin/core';
import type { McpToolMeta } from './decorator.js';

export interface RegisteredMcpTool {
  meta: McpToolMeta;
  /** Bound handler — already has `this` resolved to the providing service instance. */
  handler: (args: unknown) => unknown;
  /** JSON Schema (draft 2020-12) generated from meta.input via zod 4. */
  inputJsonSchema: object;
}

/**
 * Holds every @McpTool-decorated method discovered at app boot.
 *
 * Lookup is by tool name (unique). Registration order is preserved so the
 * tools/list response is stable.
 */
export class McpToolRegistry {
  private readonly byName = new Map<string, RegisteredMcpTool>();

  register(meta: McpToolMeta, handler: RegisteredMcpTool['handler']): void {
    if (this.byName.has(meta.name)) {
      throw new Error(`Duplicate MCP tool name: ${meta.name}`);
    }
    const inputJsonSchema = z.toJSONSchema(meta.input) as object;
    this.byName.set(meta.name, { meta, handler, inputJsonSchema });
  }

  /** All tools, optionally filtered to those visible to the given audience. */
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

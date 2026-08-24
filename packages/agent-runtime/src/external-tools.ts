import type { McpTool, McpToolHandle, McpToolResult } from './types.ts';

export const EXTERNAL_TOOL_PREFIX = 'ext_';
export const MAX_EXTERNAL_TOOLS_PER_CONNECTION = 20;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 800;

export interface ExternalToolSource {
  slug: string;
  handle: McpToolHandle;
  allowedTools: readonly string[];
}

export interface ComposeLogger {
  warn(message: string): void;
}

export function externalToolNamespace(slug: string): string {
  return `${EXTERNAL_TOOL_PREFIX}${slug}_`;
}

export function sanitizeExternalDescription(description: string | undefined): string {
  if (!description) return '';
  const cleaned = stripControlChars(description).replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_DESCRIPTION_LENGTH
    ? `${cleaned.slice(0, MAX_DESCRIPTION_LENGTH)}…`
    : cleaned;
}

export function namespaceExternalTools(
  source: ExternalToolSource,
  logger?: ComposeLogger,
): McpToolHandle {
  const prefix = externalToolNamespace(source.slug);
  const allowed = new Set(source.allowedTools);
  return {
    async listTools(): Promise<McpTool[]> {
      if (allowed.size === 0) return [];
      const offered = await source.handle.listTools();
      const tools = offered.filter((tool) => allowed.has(tool.name));
      const withheld = offered.length - tools.length;
      if (withheld > 0) {
        logger?.warn(
          `external connection ${source.slug} offered ${offered.length} tools; ${withheld} withheld because they are not allow-listed`,
        );
      }
      if (tools.length > MAX_EXTERNAL_TOOLS_PER_CONNECTION) {
        logger?.warn(
          `external connection ${source.slug} exposes ${tools.length} tools; keeping the first ${MAX_EXTERNAL_TOOLS_PER_CONNECTION}`,
        );
      }
      return tools.slice(0, MAX_EXTERNAL_TOOLS_PER_CONNECTION).flatMap((tool) => {
        const name = `${prefix}${tool.name}`.replace(/[^A-Za-z0-9_-]/g, '_');
        if (name.length > MAX_TOOL_NAME_LENGTH) {
          logger?.warn(
            `external tool ${source.slug}/${tool.name} skipped: namespaced name exceeds ${MAX_TOOL_NAME_LENGTH} chars`,
          );
          return [];
        }
        return [
          {
            name,
            description: sanitizeExternalDescription(tool.description),
            inputSchema: tool.inputSchema,
          },
        ];
      });
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      if (!name.startsWith(prefix)) {
        return errorResult(`tool '${name}' does not belong to connection ${source.slug}`);
      }
      const remoteName = name.slice(prefix.length);
      if (!allowed.has(remoteName)) {
        return errorResult(`tool '${name}' is not allow-listed on connection ${source.slug}`);
      }
      return source.handle.callTool(remoteName, args);
    },
  };
}

export function composeToolHandles(
  primary: McpToolHandle,
  externals: ExternalToolSource[],
  logger?: ComposeLogger,
): McpToolHandle {
  const namespaced = externals.map((source) => ({
    prefix: externalToolNamespace(source.slug),
    handle: namespaceExternalTools(source, logger),
  }));
  return {
    async listTools(): Promise<McpTool[]> {
      const lists = await Promise.all([
        primary.listTools(),
        ...namespaced.map(async (entry) => {
          try {
            return await entry.handle.listTools();
          } catch (err) {
            logger?.warn(
              `external tool listing failed for ${entry.prefix}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [] as McpTool[];
          }
        }),
      ]);
      return lists.flat();
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      const entry = namespaced
        .filter((candidate) => name.startsWith(candidate.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
      if (!entry) return primary.callTool(name, args);
      try {
        return await entry.handle.callTool(name, args);
      } catch (err) {
        return errorResult(
          `external tool call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

function errorResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function stripControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out;
}

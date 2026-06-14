import type { Audience } from '@getmunin/core';

export const SKILLS_LIST_TOOL = 'skills_list';
export const SKILLS_READ_TOOL = 'skills_read';

/**
 * Single source of truth for the synthetic skill tools. These mirror the MCP
 * `resources/list` / `resources/read` surface as plain tools so clients that
 * don't expose server resources can still discover and read `skill://` guides.
 *
 * Consumed both by the dispatch layer (live `tools/list`) and the public tool
 * catalog so the two never drift. They carry no scopes; output is filtered by
 * the caller's audience at call time.
 */
export interface SkillToolDescriptor {
  name: string;
  title: string;
  description: string;
  audiences: readonly Audience[];
  scopes: readonly string[];
  readOnlyHint: boolean;
  destructiveHint: boolean;
  inputSchema: Record<string, unknown>;
}

export const SKILL_TOOLS: readonly SkillToolDescriptor[] = [
  {
    name: SKILLS_LIST_TOOL,
    title: 'List skills',
    description:
      'List the available skills and playbooks — step-by-step guides for multi-step and cross-module workflows (their URIs use the `skill://` scheme). Before any setup-style task (wiring a frontend, launching a support desk, importing leads, …), call this and read the relevant guide with `skills_read` so you follow the canonical approach instead of rediscovering the same gotchas. This mirrors the MCP `resources/list` surface for clients that do not expose server resources to the model.',
    audiences: ['admin', 'self_service'],
    scopes: [],
    readOnlyHint: true,
    destructiveHint: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: SKILLS_READ_TOOL,
    title: 'Read a skill',
    description:
      'Read the full markdown of one skill or playbook by its `skill://` URI (get URIs from `skills_list`). Mirrors the MCP `resources/read` surface for clients that do not expose server resources to the model.',
    audiences: ['admin', 'self_service'],
    scopes: [],
    readOnlyHint: true,
    destructiveHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'The skill:// URI to read, e.g. skill://playbooks/frontend-integration',
        },
      },
      required: ['uri'],
      additionalProperties: false,
    },
  },
];

export function getSkillToolDescriptor(name: string): SkillToolDescriptor | undefined {
  return SKILL_TOOLS.find((t) => t.name === name);
}

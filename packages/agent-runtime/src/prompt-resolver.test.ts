import { describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_PROMPT_PREFIX,
  DEFAULT_CHANNEL_DEFAULT_PROMPT,
  DEFAULT_CHANNEL_EMAIL_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_VOICE_OPENER_COLD,
  DEFAULT_VOICE_OPENER_CONTINUATION,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  SEEDABLE_PROMPTS,
} from '@getmunin/core';
import {
  PROMPT_SPACE_SLUG,
  SYSTEM_PROMPT_SLUG,
  createPromptResolver,
} from './prompt-resolver.js';
import type { McpTool, McpToolHandle, McpToolResult } from './types.js';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface FakeMcpHandle extends McpToolHandle {
  calls: ToolCall[];
}

function fakeMcp(opts: {
  existingDocs?: Record<string, string>;
  spaceId?: string;
  spaceExistsBeforeBoot?: boolean;
} = {}): FakeMcpHandle {
  const existing = new Map(Object.entries(opts.existingDocs ?? {}));
  const spaceId = opts.spaceId ?? 'spc_test';
  let spaceExists = opts.spaceExistsBeforeBoot ?? false;
  const calls: ToolCall[] = [];
  const handle: FakeMcpHandle = {
    calls,
    listTools: () => Promise.resolve<McpTool[]>([]),
    callTool: (name: string, args: Record<string, unknown>): Promise<McpToolResult> => {
      calls.push({ name, args });
      if (name === 'kb_create_space') {
        if (spaceExists) {
          return Promise.reject(new Error('conflict: slug already in use'));
        }
        spaceExists = true;
        return Promise.resolve({ content: [{ type: 'text', text: '{}' }] });
      }
      if (name === 'kb_list_spaces') {
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify(spaceExists ? [{ id: spaceId, slug: PROMPT_SPACE_SLUG }] : []),
            },
          ],
        });
      }
      if (name === 'kb_get_document_by_slug') {
        const slug = args['slug'] as string;
        const body = existing.get(slug);
        if (body === undefined) {
          return Promise.resolve({ content: [{ type: 'text', text: 'null' }] });
        }
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify({ slug, body }) }],
        });
      }
      if (name === 'kb_create_document') {
        const slug = args['slug'] as string;
        const body = args['body'] as string;
        existing.set(slug, body);
        return Promise.resolve({ content: [{ type: 'text', text: '{}' }] });
      }
      return Promise.reject(new Error(`unexpected tool ${name}`));
    },
  };
  return handle;
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('createPromptResolver', () => {
  it('creates the space and seeds every default prompt on boot', async () => {
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ mcp, logger: silentLogger });

    const created = mcp.calls.filter((c) => c.name === 'kb_create_document');
    const slugs = created.map((c) => c.args['slug']);
    for (const seed of SEEDABLE_PROMPTS) {
      expect(slugs).toContain(seed.slug);
    }

    expect(resolver.system()).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(resolver.channel('email')).toBe(DEFAULT_CHANNEL_EMAIL_PROMPT);
    expect(resolver.voiceSystem()).toBe(DEFAULT_VOICE_SYSTEM_PROMPT);
    expect(resolver.voiceOpener(false)).toBe(DEFAULT_VOICE_OPENER_COLD);
    expect(resolver.voiceOpener(true)).toBe(DEFAULT_VOICE_OPENER_CONTINUATION);
  });

  it('does not overwrite an operator-edited doc that already exists in the KB', async () => {
    const mcp = fakeMcp({
      spaceExistsBeforeBoot: true,
      existingDocs: {
        [SYSTEM_PROMPT_SLUG]: 'OPERATOR_EDITED_SYSTEM',
        [`${CHANNEL_PROMPT_PREFIX}email`]: 'OPERATOR_EDITED_EMAIL',
      },
    });
    const resolver = await createPromptResolver({ mcp, logger: silentLogger });

    const created = mcp.calls.filter((c) => c.name === 'kb_create_document');
    const createdSlugs = created.map((c) => c.args['slug']);
    expect(createdSlugs).not.toContain(SYSTEM_PROMPT_SLUG);
    expect(createdSlugs).not.toContain(`${CHANNEL_PROMPT_PREFIX}email`);

    expect(resolver.system()).toBe('OPERATOR_EDITED_SYSTEM');
    expect(resolver.channel('email')).toBe('OPERATOR_EDITED_EMAIL');
  });

  it('falls back to channel-default when an unknown channel kind is queried', async () => {
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ mcp, logger: silentLogger });
    expect(resolver.channel('made-up-kind')).toBe(DEFAULT_CHANNEL_DEFAULT_PROMPT);
  });

  it('refresh() re-fetches a doc body from the KB', async () => {
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ mcp, logger: silentLogger });
    expect(resolver.system()).toBe(DEFAULT_SYSTEM_PROMPT);

    const callTool = vi.spyOn(mcp, 'callTool');
    callTool.mockImplementationOnce(() =>
      Promise.resolve({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ slug: SYSTEM_PROMPT_SLUG, body: 'EDITED_VIA_KB' }),
          },
        ],
      }),
    );
    await resolver.refresh(SYSTEM_PROMPT_SLUG);
    expect(resolver.system()).toBe('EDITED_VIA_KB');
  });

  it('isPromptDocument recognizes our slugs only', async () => {
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ mcp, logger: silentLogger });
    expect(resolver.isPromptDocument(SYSTEM_PROMPT_SLUG)).toBe(true);
    expect(resolver.isPromptDocument(`${CHANNEL_PROMPT_PREFIX}email`)).toBe(true);
    expect(resolver.isPromptDocument('some-other-doc')).toBe(false);
    expect(resolver.isPromptDocument(null)).toBe(false);
    expect(resolver.isPromptDocument(undefined)).toBe(false);
  });
});

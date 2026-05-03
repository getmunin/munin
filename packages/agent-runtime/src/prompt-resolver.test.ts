import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHANNEL_PROMPT_PREFIX,
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

function writePrompts(opts: {
  system?: string;
  channels?: Record<string, string>;
} = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'prompts-test-'));
  mkdirSync(join(dir, 'channels'), { recursive: true });
  writeFileSync(join(dir, 'system.md'), opts.system ?? 'BASE_SYSTEM_PROMPT');
  for (const [kind, body] of Object.entries(opts.channels ?? {})) {
    writeFileSync(join(dir, 'channels', `${kind}.md`), body);
  }
  return dir;
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('createPromptResolver', () => {
  it('creates the space and seeds missing docs from disk on boot', async () => {
    const dir = writePrompts({
      system: 'SYS_DEFAULT',
      channels: { email: 'EMAIL_DEFAULT', chat: 'CHAT_DEFAULT' },
    });
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger });

    const created = mcp.calls.filter((c) => c.name === 'kb_create_document');
    const slugs = created.map((c) => c.args['slug']);
    expect(slugs).toContain(SYSTEM_PROMPT_SLUG);
    expect(slugs).toContain(`${CHANNEL_PROMPT_PREFIX}email`);
    expect(slugs).toContain(`${CHANNEL_PROMPT_PREFIX}chat`);

    expect(resolver.system()).toBe('SYS_DEFAULT');
    expect(resolver.channel('email')).toBe('EMAIL_DEFAULT');
    expect(resolver.channel('chat')).toBe('CHAT_DEFAULT');
  });

  it('does not overwrite an operator-edited doc that already exists in the KB', async () => {
    const dir = writePrompts({
      system: 'SHIPPED_DEFAULT',
      channels: { email: 'SHIPPED_EMAIL' },
    });
    const mcp = fakeMcp({
      spaceExistsBeforeBoot: true,
      existingDocs: {
        [SYSTEM_PROMPT_SLUG]: 'OPERATOR_EDITED_SYSTEM',
        [`${CHANNEL_PROMPT_PREFIX}email`]: 'OPERATOR_EDITED_EMAIL',
      },
    });
    const resolver = await createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger });

    const created = mcp.calls.filter((c) => c.name === 'kb_create_document');
    expect(created).toHaveLength(0);

    expect(resolver.system()).toBe('OPERATOR_EDITED_SYSTEM');
    expect(resolver.channel('email')).toBe('OPERATOR_EDITED_EMAIL');
  });

  it('falls back to channel-default when an unknown channel kind is queried', async () => {
    const dir = writePrompts({
      system: 'SYS',
      channels: { default: 'GENERIC_DESCRIPTOR' },
    });
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger });
    expect(resolver.channel('made-up-kind')).toBe('GENERIC_DESCRIPTOR');
  });

  it('returns empty string for an unknown channel when no default is on disk', async () => {
    const dir = writePrompts({ system: 'SYS', channels: { email: 'E' } });
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger });
    expect(resolver.channel('voice')).toBe('');
  });

  it('refresh() re-fetches a doc body from the KB', async () => {
    const dir = writePrompts({ system: 'SYS' });
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger });
    expect(resolver.system()).toBe('SYS');

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
    const dir = writePrompts({ system: 'SYS' });
    const mcp = fakeMcp();
    const resolver = await createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger });
    expect(resolver.isPromptDocument(SYSTEM_PROMPT_SLUG)).toBe(true);
    expect(resolver.isPromptDocument(`${CHANNEL_PROMPT_PREFIX}email`)).toBe(true);
    expect(resolver.isPromptDocument('some-other-doc')).toBe(false);
    expect(resolver.isPromptDocument(null)).toBe(false);
    expect(resolver.isPromptDocument(undefined)).toBe(false);
  });

  it('throws when system.md is missing from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prompts-empty-'));
    const mcp = fakeMcp();
    await expect(
      createPromptResolver({ promptsDir: dir, mcp, logger: silentLogger }),
    ).rejects.toThrow(/system\.md/);
  });
});

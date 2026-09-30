import { describe, it, expect, vi } from 'vitest';
import { runSkillPass, withAllowedTools, type SkillReader } from './skill-pass.ts';
import type {
  ChatMessage,
  McpTool,
  McpToolHandle,
  McpToolResult,
  ProviderResponse,
} from './types.ts';

const noopMcp: McpToolHandle = {
  listTools: () => Promise.resolve([]),
  callTool: () => Promise.resolve({ content: [] }),
};

const noopSkills: SkillReader = {
  readSkill: () => Promise.resolve(null),
};

describe('runSkillPass', () => {
  it('returns skipped:no_provider_key when providerApiKey is empty', async () => {
    const result = await runSkillPass({
      mcp: noopMcp,
      skills: noopSkills,
      providerBaseUrl: 'http://localhost:1',
      providerApiKey: '',
      model: 'm',
      skillUri: 'skill://x/y',
      userPrompt: 'go',
    });
    expect(result).toEqual({ ok: false, skipped: 'no_provider_key' });
  });

  it('returns skipped:skill_missing when readSkill resolves to null', async () => {
    const result = await runSkillPass({
      mcp: noopMcp,
      skills: noopSkills,
      providerBaseUrl: 'http://localhost:1',
      providerApiKey: 'k',
      model: 'm',
      skillUri: 'skill://x/missing',
      userPrompt: 'go',
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(result).toEqual({ ok: false, skipped: 'skill_missing' });
  });

  it('withAllowedTools lists and calls only exactly-named tools', async () => {
    const allTools: McpTool[] = [
      { name: 'kb_search', description: 'a', inputSchema: { type: 'object', properties: {} } },
      { name: 'kb_propose_curation_candidate', description: 'b', inputSchema: { type: 'object', properties: {} } },
      { name: 'conv_get_conversation', description: 'c', inputSchema: { type: 'object', properties: {} } },
      { name: 'cms_list_collections', description: 'd', inputSchema: { type: 'object', properties: {} } },
      { name: 'ping', description: 'f', inputSchema: { type: 'object', properties: {} } },
    ];
    const callSpy = vi.fn((): Promise<McpToolResult> => Promise.resolve({ content: [] }));
    const inner: McpToolHandle = {
      listTools: () => Promise.resolve(allTools),
      callTool: callSpy,
    };
    const handle = withAllowedTools(inner, ['conv_get_conversation', 'kb_search']);

    const tools = await handle.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['conv_get_conversation', 'kb_search']);

    const blocked = await handle.callTool('cms_list_collections', {});
    expect(blocked.isError).toBe(true);
    expect(callSpy).not.toHaveBeenCalled();

    await handle.callTool('kb_search', { q: 'x' });
    expect(callSpy).toHaveBeenCalledWith('kb_search', { q: 'x' });
  });

  it('withAllowedTools refuses a longer tool name that merely starts with an allowed one', async () => {
    const allTools: McpTool[] = [
      { name: 'conv_set_topic', description: 'a', inputSchema: { type: 'object', properties: {} } },
      { name: 'conv_set_topic_automation', description: 'b', inputSchema: { type: 'object', properties: {} } },
    ];
    const callSpy = vi.fn((): Promise<McpToolResult> => Promise.resolve({ content: [] }));
    const handle = withAllowedTools(
      { listTools: () => Promise.resolve(allTools), callTool: callSpy },
      ['conv_set_topic'],
    );

    expect((await handle.listTools()).map((t) => t.name)).toEqual(['conv_set_topic']);
    const blocked = await handle.callTool('conv_set_topic_automation', { mode: 'auto' });
    expect(blocked.isError).toBe(true);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('withAllowedTools with an empty list exposes and calls nothing', async () => {
    const callSpy = vi.fn((): Promise<McpToolResult> => Promise.resolve({ content: [] }));
    const handle = withAllowedTools(
      {
        listTools: () =>
          Promise.resolve([
            { name: 'cms_list_collections', description: 'a', inputSchema: { type: 'object', properties: {} } },
          ]),
        callTool: callSpy,
      },
      [],
    );
    expect(await handle.listTools()).toEqual([]);
    expect((await handle.callTool('cms_list_collections', {})).isError).toBe(true);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['no allow-list', undefined],
    ['an empty allow-list', []],
  ])('refuses to run a skill with %s instead of granting every tool', async (_label, allowedTools) => {
    const provider = vi.fn(
      (): Promise<ProviderResponse> =>
        Promise.resolve({ message: { role: 'assistant', content: 'done' }, finishReason: 'stop' }),
    );
    const listTools = vi.fn(() => Promise.resolve([]));
    const result = await runSkillPass({
      mcp: { listTools, callTool: () => Promise.resolve({ content: [] }) },
      skills: { readSkill: () => Promise.resolve('# skill body') },
      providerBaseUrl: 'https://api.anthropic.com',
      providerApiKey: 'k',
      model: 'm',
      skillUri: 'skill://x/unmapped',
      userPrompt: 'go',
      providerImpl: provider,
      allowedTools,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(result).toEqual({ ok: false, skipped: 'no_tool_allowlist' });
    expect(provider).not.toHaveBeenCalled();
    expect(listTools).not.toHaveBeenCalled();
  });

  it('puts conversation images on the synthetic user turn so the curator can see them', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => '3' },
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: ChatMessage[][] = [];
    const provider = (args: { messages: ChatMessage[] }): Promise<ProviderResponse> => {
      seen.push(args.messages);
      return Promise.resolve({
        message: { role: 'assistant', content: 'done' },
        finishReason: 'stop',
      });
    };
    try {
      const result = await runSkillPass({
        mcp: noopMcp,
        skills: { readSkill: () => Promise.resolve('# skill body') },
        providerBaseUrl: 'https://api.anthropic.com',
        providerApiKey: 'k',
        model: 'm',
        skillUri: 'skill://conv/set-topic-and-title',
        userPrompt: 'title this conversation',
        userPromptAttachments: [
          { mime: 'image/png', url: 'https://assets.example.com/a.png', name: 'a.png' },
        ],
        providerImpl: provider,
        allowedTools: ['conv_get_conversation'],
      });
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('https://assets.example.com/a.png');
      const userTurn = seen[0]?.find((m) => m.role === 'user');
      expect(userTurn?.images).toHaveLength(1);
      expect(userTurn?.images?.[0]?.mime).toBe('image/png');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves the user turn imageless when the job names no conversation attachments', async () => {
    const seen: ChatMessage[][] = [];
    const provider = (args: { messages: ChatMessage[] }): Promise<ProviderResponse> => {
      seen.push(args.messages);
      return Promise.resolve({
        message: { role: 'assistant', content: 'done' },
        finishReason: 'stop',
      });
    };
    const result = await runSkillPass({
      mcp: noopMcp,
      skills: { readSkill: () => Promise.resolve('# skill body') },
      providerBaseUrl: 'https://api.anthropic.com',
      providerApiKey: 'k',
      model: 'm',
      skillUri: 'skill://conv/set-topic-and-title',
      userPrompt: 'title this conversation',
      providerImpl: provider,
      allowedTools: ['conv_get_conversation'],
    });
    expect(result.ok).toBe(true);
    expect(seen[0]?.find((m) => m.role === 'user')?.images).toBeUndefined();
  });
});

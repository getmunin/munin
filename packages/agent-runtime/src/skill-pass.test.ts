import { describe, it, expect, vi } from 'vitest';
import { runSkillPass, withAllowedToolPrefixes, type SkillReader } from './skill-pass.ts';
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

  it('withAllowedToolPrefixes filters listTools and blocks disallowed callTool', async () => {
    const allTools: McpTool[] = [
      { name: 'kb_search', description: 'a', inputSchema: { type: 'object', properties: {} } },
      { name: 'kb_propose_curation_candidate', description: 'b', inputSchema: { type: 'object', properties: {} } },
      { name: 'conv_get_conversation', description: 'c', inputSchema: { type: 'object', properties: {} } },
      { name: 'cms_list_collections', description: 'd', inputSchema: { type: 'object', properties: {} } },
      { name: 'crm_list_contacts', description: 'e', inputSchema: { type: 'object', properties: {} } },
      { name: 'ping', description: 'f', inputSchema: { type: 'object', properties: {} } },
    ];
    const callSpy = vi.fn((): Promise<McpToolResult> => Promise.resolve({ content: [] }));
    const inner: McpToolHandle = {
      listTools: () => Promise.resolve(allTools),
      callTool: callSpy,
    };
    const handle = withAllowedToolPrefixes(inner, ['conv_', 'kb_']);

    const tools = await handle.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'conv_get_conversation',
      'kb_propose_curation_candidate',
      'kb_search',
    ]);

    const blocked = await handle.callTool('cms_list_collections', {});
    expect(blocked.isError).toBe(true);
    expect(callSpy).not.toHaveBeenCalled();

    await handle.callTool('kb_search', { q: 'x' });
    expect(callSpy).toHaveBeenCalledWith('kb_search', { q: 'x' });
  });

  it('withAllowedToolPrefixes is a no-op when prefix list is empty', () => {
    const inner: McpToolHandle = {
      listTools: () =>
        Promise.resolve([
          { name: 'cms_list_collections', description: 'a', inputSchema: { type: 'object', properties: {} } },
        ]),
      callTool: () => Promise.resolve({ content: [] }),
    };
    expect(withAllowedToolPrefixes(inner, [])).toBe(inner);
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
    });
    expect(result.ok).toBe(true);
    expect(seen[0]?.find((m) => m.role === 'user')?.images).toBeUndefined();
  });
});

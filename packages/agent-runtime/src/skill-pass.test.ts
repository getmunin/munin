import { describe, it, expect, vi } from 'vitest';
import { runSkillPass, withAllowedToolPrefixes } from './skill-pass.js';
import type { McpTool, McpToolHandle, McpToolResult } from './types.js';

describe('runSkillPass', () => {
  it('returns skipped:no_admin_key when adminApiKey is empty', async () => {
    const result = await runSkillPass({
      baseUrl: 'http://localhost:1',
      adminApiKey: '',
      providerBaseUrl: 'http://localhost:1',
      providerApiKey: 'k',
      model: 'm',
      skillUri: 'skill://x/y',
      userPrompt: 'go',
    });
    expect(result).toEqual({ ok: false, skipped: 'no_admin_key' });
  });

  it('returns skipped:no_provider_key when providerApiKey is empty', async () => {
    const result = await runSkillPass({
      baseUrl: 'http://localhost:1',
      adminApiKey: 'k',
      providerBaseUrl: 'http://localhost:1',
      providerApiKey: '',
      model: 'm',
      skillUri: 'skill://x/y',
      userPrompt: 'go',
    });
    expect(result).toEqual({ ok: false, skipped: 'no_provider_key' });
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

  it('returns skipped:mcp_connect_failed against an unreachable baseUrl', async () => {
    const result = await runSkillPass({
      baseUrl: 'http://127.0.0.1:1',
      adminApiKey: 'k',
      providerBaseUrl: 'http://localhost:1',
      providerApiKey: 'k',
      model: 'm',
      skillUri: 'skill://x/y',
      userPrompt: 'go',
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipped).toBe('mcp_connect_failed');
    }
  }, 15_000);
});

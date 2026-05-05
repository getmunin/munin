import { describe, it, expect } from 'vitest';
import { runSkillPass } from './skill-pass.js';

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

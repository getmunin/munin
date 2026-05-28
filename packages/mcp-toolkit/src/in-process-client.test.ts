import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import { McpToolRegistry } from './registry.ts';
import { SkillRegistry } from './skill-registry.ts';
import { openInProcessMcpClient } from './in-process-client.ts';

const fakeAudit = { record: vi.fn(() => Promise.resolve()) };

const fakeTx = {
  transaction: <T>(fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as RequestContext['db'];

function runInCtx<T>(actor: ActorIdentity, fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = { db: fakeTx, actor, correlationId: 'test-corr' };
  return RequestContextStore.run(ctx, fn);
}

function adminActor(orgId = 'org_test'): ActorIdentity {
  return new ActorIdentity('admin_agent', `agent:${orgId}`, orgId, ['*'], ['admin']);
}

function buildRegistry(): McpToolRegistry {
  const r = new McpToolRegistry();
  r.register(
    {
      name: 'echo',
      description: 'echo',
      audiences: ['admin'],
      scopes: [],
      input: z.object({ msg: z.string() }),
    },
    (args) => (args as { msg: string }).msg,
  );
  r.register(
    {
      name: 'self_only',
      description: 'self',
      audiences: ['self_service'],
      scopes: [],
      input: z.object({}),
    },
    () => 'ok',
  );
  r.register(
    {
      name: 'kb_write',
      description: 'requires kb:write',
      audiences: ['admin'],
      scopes: ['kb:write'],
      input: z.object({}),
    },
    () => 'wrote',
  );
  return r;
}

describe('openInProcessMcpClient', () => {
  it('listTools returns audience-filtered tools', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('echo');
    expect(names).toContain('kb_write');
    expect(names).not.toContain('self_only');
  });

  it('callTool dispatches the handler, returns text content, audits ok', async () => {
    fakeAudit.record.mockClear();
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const out = await runInCtx(adminActor(), () => client.callTool('echo', { msg: 'hi' }));
    expect(out.isError).toBeUndefined();
    expect(out.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'echo', result: 'ok' }),
    );
  });

  it('callTool rejects an unknown tool with a denied audit row', async () => {
    fakeAudit.record.mockClear();
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const out = await client.callTool('nope', {});
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/Unknown tool/);
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'denied', error: 'unknown_tool' }),
    );
  });

  it('callTool rejects audience-mismatched tool', async () => {
    fakeAudit.record.mockClear();
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const out = await client.callTool('self_only', {});
    expect(out.isError).toBe(true);
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'denied', error: 'audience_mismatch' }),
    );
  });

  it('self-service actor with broad scopes is still blocked by audience gate on admin tools', async () => {
    fakeAudit.record.mockClear();
    const selfServiceWithBroadScopes = new ActorIdentity(
      'end_user_agent',
      'agent:eu_1',
      'org_test',
      ['kb:write', 'kb:read', 'conv:write', 'crm:write'],
      ['self_service'],
      'eu_1',
    );
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: selfServiceWithBroadScopes,
      audience: 'self_service',
      audit: fakeAudit,
    });

    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['self_only']);
    expect(names).not.toContain('echo');
    expect(names).not.toContain('kb_write');

    const out = await client.callTool('kb_write', {});
    expect(out.isError).toBe(true);
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'kb_write', result: 'denied', error: 'audience_mismatch' }),
    );
  });

  it('callTool enforces scopes against the actor', async () => {
    fakeAudit.record.mockClear();
    const scopedActor = new ActorIdentity(
      'admin_agent',
      'agent:scoped',
      'org_test',
      ['kb:read'],
      ['admin'],
    );
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: scopedActor,
      audience: 'admin',
      audit: fakeAudit,
    });
    const out = await client.callTool('kb_write', {});
    expect(out.isError).toBe(true);
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'denied', error: 'missing_scope:kb:write' }),
    );
  });

  it('readResource returns audience-filtered skill content', () => {
    const skills = new SkillRegistry();
    skills.register({
      uri: 'skill://kb/onboarding',
      name: 'Onboarding',
      description: 'KB onboarding',
      audiences: ['admin'],
      mimeType: 'text/markdown',
      content: '# go',
      public: false,
    });
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      skills,
    });
    return expect(client.readResource('skill://kb/onboarding')).resolves.toEqual({
      uri: 'skill://kb/onboarding',
      mimeType: 'text/markdown',
      text: '# go',
    });
  });
});

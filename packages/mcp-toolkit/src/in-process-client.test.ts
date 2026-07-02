import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import { McpToolRegistry } from './registry.ts';
import { SkillRegistry, APP_RESOURCE_MIME_TYPE } from './skill-registry.ts';
import { openInProcessMcpClient } from './in-process-client.ts';
import {
  listAppResources,
  listResources,
  readResource,
  type CaptureExceptionContext,
  type CaptureExceptionFn,
  type DispatchContext,
} from './dispatch.ts';

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
  r.register(
    {
      name: 'boom',
      description: 'throws',
      audiences: ['admin'],
      scopes: [],
      input: z.object({ note: z.string() }),
    },
    () => {
      throw new Error('handler exploded');
    },
  );
  r.register(
    {
      name: 'void_tool',
      description: 'returns undefined',
      audiences: ['admin'],
      scopes: [],
      input: z.object({}),
    },
    () => undefined,
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

  it('callTool coerces a void return into a valid text result (never undefined)', async () => {
    // Regression: JSON.stringify(undefined) === undefined, which fails the MCP
    // CallToolResult schema and surfaces as a transport-level -32602 error.
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const out = await runInCtx(adminActor(), () => client.callTool('void_tool', {}));
    expect(out.isError).toBeUndefined();
    expect(out.content[0]).toEqual({ type: 'text', text: 'null' });
    expect(typeof out.content[0]?.text).toBe('string');
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

  it('listTools hides tools whose required scopes the actor lacks', async () => {
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
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('echo');
    expect(names).toContain('boom');
    expect(names).not.toContain('kb_write');
  });

  it('listTools shows all audience-matched tools when actor has wildcard scope', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('kb_write');
  });

  it('audits args (redacted) and forwards thrown handler errors to captureException', async () => {
    fakeAudit.record.mockClear();
    const captureException = vi.fn<CaptureExceptionFn>();
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      captureException,
    });
    const out = await runInCtx(adminActor(), () => client.callTool('boom', { note: 'hi' }));
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toBe('handler exploded');
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'boom',
        result: 'error',
        error: 'handler exploded',
        args: { note: 'hi' },
      }),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    const call = captureException.mock.calls[0];
    expect(call).toBeDefined();
    const thrown = call![0] as Error;
    const ctx = call![1] as CaptureExceptionContext;
    expect(thrown.message).toBe('handler exploded');
    expect(ctx).toMatchObject({
      tool: 'boom',
      actor: { type: 'admin_agent', orgId: 'org_test' },
      args: { note: 'hi' },
    });
  });

  it('audits args on invalid_input and does not call captureException', async () => {
    fakeAudit.record.mockClear();
    const captureException = vi.fn<CaptureExceptionFn>();
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      captureException,
    });
    const out = await runInCtx(adminActor(), () =>
      client.callTool('echo', { msg: 42 }),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/Invalid input/);
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'echo',
        result: 'error',
        args: { msg: 42 },
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  function skillsRegistry(): SkillRegistry {
    const skills = new SkillRegistry();
    skills.register({
      uri: 'skill://playbooks/frontend-integration',
      name: 'Frontend integration',
      description: 'Wire a frontend to a Munin tenant',
      audiences: ['admin'],
      mimeType: 'text/markdown',
      content: '# Frontend integration\nbody',
      public: true,
    });
    skills.register({
      uri: 'skill://kb/self-help',
      name: 'Self help',
      description: 'End-user guide',
      audiences: ['self_service'],
      mimeType: 'text/markdown',
      content: '# self',
      public: true,
    });
    return skills;
  }

  it('exposes skills_list and skills_read tools when skills are present', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      skills: skillsRegistry(),
    });
    const names = (await client.listTools()).map((t) => t.name);
    expect(names).toContain('skills_list');
    expect(names).toContain('skills_read');
  });

  it('does not expose skill tools when no skills are visible to the audience', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
    });
    const names = (await client.listTools()).map((t) => t.name);
    expect(names).not.toContain('skills_list');
    expect(names).not.toContain('skills_read');
  });

  it('skills_list returns audience-filtered skill URIs', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      skills: skillsRegistry(),
    });
    const out = await runInCtx(adminActor(), () => client.callTool('skills_list', {}));
    expect(out.isError).toBeUndefined();
    const listed = JSON.parse(out.content[0]!.text) as Array<{ uri: string }>;
    const uris = listed.map((s) => s.uri);
    expect(uris).toContain('skill://playbooks/frontend-integration');
    expect(uris).not.toContain('skill://kb/self-help');
  });

  it('skills_read returns the skill markdown by URI', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      skills: skillsRegistry(),
    });
    const out = await runInCtx(adminActor(), () =>
      client.callTool('skills_read', { uri: 'skill://playbooks/frontend-integration' }),
    );
    expect(out.isError).toBeUndefined();
    expect(out.content[0]!.text).toContain('# Frontend integration');
  });

  it('skills_read denies a skill outside the caller audience', async () => {
    fakeAudit.record.mockClear();
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      skills: skillsRegistry(),
    });
    const out = await runInCtx(adminActor(), () =>
      client.callTool('skills_read', { uri: 'skill://kb/self-help' }),
    );
    expect(out.isError).toBe(true);
    expect(fakeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'skills_read', result: 'denied', error: 'audience_mismatch' }),
    );
  });

  it('skills_read errors on a missing uri argument', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor(),
      audience: 'admin',
      audit: fakeAudit,
      skills: skillsRegistry(),
    });
    const out = await runInCtx(adminActor(), () => client.callTool('skills_read', {}));
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/uri/);
  });

  function templatedSkills(): SkillRegistry {
    const skills = new SkillRegistry();
    skills.register({
      uri: 'skill://playbooks/frontend-integration',
      name: 'Frontend integration',
      description: 'Wire a frontend to a Munin tenant',
      audiences: ['admin'],
      mimeType: 'text/markdown',
      content: 'src={{API_URL}}/widget.js for {{ORG_ID}}',
      public: true,
    });
    return skills;
  }

  it('skills_read substitutes API_URL and ORG_ID into the skill body', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor('org_abc'),
      audience: 'admin',
      audit: fakeAudit,
      skills: templatedSkills(),
      apiBaseUrl: 'https://api.getmunin.com',
    });
    const out = await runInCtx(adminActor('org_abc'), () =>
      client.callTool('skills_read', { uri: 'skill://playbooks/frontend-integration' }),
    );
    expect(out.content[0]!.text).toBe('src=https://api.getmunin.com/widget.js for org_abc');
  });

  it('readResource substitutes API_URL and ORG_ID into the skill body', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor('org_abc'),
      audience: 'admin',
      audit: fakeAudit,
      skills: templatedSkills(),
      apiBaseUrl: 'https://api.getmunin.com',
    });
    const out = await client.readResource('skill://playbooks/frontend-integration');
    expect(out.text).toBe('src=https://api.getmunin.com/widget.js for org_abc');
  });

  it('leaves placeholders intact when no apiBaseUrl is provided', async () => {
    const client = openInProcessMcpClient({
      registry: buildRegistry(),
      actor: adminActor('org_abc'),
      audience: 'admin',
      audit: fakeAudit,
      skills: templatedSkills(),
    });
    const out = await client.readResource('skill://playbooks/frontend-integration');
    expect(out.text).toBe('src={{API_URL}}/widget.js for org_abc');
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

describe('ui:// MCP App resources (SEP-1865)', () => {
  function mixedRegistry(): SkillRegistry {
    const skills = new SkillRegistry();
    skills.register({
      uri: 'skill://playbooks/frontend-integration',
      name: 'Frontend integration',
      description: 'markdown guide',
      audiences: ['admin'],
      mimeType: 'text/markdown',
      content: '# guide',
      public: true,
    });
    skills.register({
      uri: 'ui://inspector/hello',
      name: 'Inspector: Hello Munin',
      description: 'spike panel',
      audiences: ['admin'],
      mimeType: APP_RESOURCE_MIME_TYPE,
      content: '<!DOCTYPE html><body>hello</body>',
      public: false,
      meta: { ui: { csp: { resourceDomains: ['https://esm.sh'] } } },
    });
    return skills;
  }

  function ctx(actor: ActorIdentity, audience: 'admin' | 'self_service'): DispatchContext {
    return { registry: buildRegistry(), audience, actor, audit: fakeAudit, skills: mixedRegistry() };
  }

  it('listResources stays skill:// only so skills_list never leaks ui:// panels', () => {
    const uris = listResources(ctx(adminActor(), 'admin')).map((r) => r.uri);
    expect(uris).toContain('skill://playbooks/frontend-integration');
    expect(uris).not.toContain('ui://inspector/hello');
  });

  it('listAppResources returns ui:// panels with the App mime type and resource _meta', () => {
    const listed = listAppResources(ctx(adminActor(), 'admin'));
    expect(listed).toEqual([
      {
        uri: 'ui://inspector/hello',
        name: 'Inspector: Hello Munin',
        description: 'spike panel',
        mimeType: 'text/html;profile=mcp-app',
        _meta: { ui: { csp: { resourceDomains: ['https://esm.sh'] } } },
      },
    ]);
  });

  it('readResource serves the panel HTML with its _meta passthrough', () => {
    const out = readResource(ctx(adminActor(), 'admin'), 'ui://inspector/hello');
    expect(out.mimeType).toBe(APP_RESOURCE_MIME_TYPE);
    expect(out.text).toContain('hello');
    expect(out._meta).toEqual({ ui: { csp: { resourceDomains: ['https://esm.sh'] } } });
  });

  it('hides admin-only ui:// panels from a self-service caller', () => {
    const selfActor = new ActorIdentity('end_user', 'eu:1', 'org_test', [], ['self_service']);
    expect(listAppResources(ctx(selfActor, 'self_service'))).toEqual([]);
    expect(() => readResource(ctx(selfActor, 'self_service'), 'ui://inspector/hello')).toThrow(
      /not available/,
    );
  });
});

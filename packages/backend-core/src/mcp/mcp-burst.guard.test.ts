import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ContextType,
  ExecutionContext,
  Type,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ResolvedCredential } from '@getmunin/core';
import { McpBurstGuard } from './mcp-burst.guard.ts';

type HttpArgumentsHost = ReturnType<ExecutionContext['switchToHttp']>;
type RpcArgumentsHost = ReturnType<ExecutionContext['switchToRpc']>;
type WsArgumentsHost = ReturnType<ExecutionContext['switchToWs']>;

class MockExecutionContext implements ExecutionContext {
  constructor(private readonly request: Partial<Request>) {}
  switchToHttp(): HttpArgumentsHost {
    const req = this.request;
    return {
      getRequest<T>(): T { return req as T; },
      getResponse<T>(): T { return {} as T; },
      getNext<T>(): T { return undefined as T; },
    };
  }
  switchToRpc(): RpcArgumentsHost { throw new Error('not implemented'); }
  switchToWs(): WsArgumentsHost { throw new Error('not implemented'); }
  getType<TContext extends string = ContextType>(): TContext { return 'http' as TContext; }
  getClass<T = unknown>(): Type<T> { throw new Error('not implemented'); }
  getHandler(): (...args: unknown[]) => unknown { throw new Error('not implemented'); }
  getArgs<T extends Array<unknown> = unknown[]>(): T { return [] as unknown[] as T; }
  getArgByIndex<T = unknown>(_index: number): T { throw new Error('not implemented'); }
}

function makeRequest(orgId: string | null, ip = '10.0.0.1'): Partial<Request> {
  const credential = orgId
    ? {
        actor: { orgId, type: 'admin_agent', id: 'agt_x', scopes: ['*'], audiences: ['admin'] },
      }
    : undefined;
  return {
    ip,
    socket: { remoteAddress: ip } as Request['socket'],
    credential,
  } as Partial<Request> & { credential?: ResolvedCredential };
}

function makeContext(request: Partial<Request>): ExecutionContext {
  return new MockExecutionContext(request);
}

describe('McpBurstGuard', () => {
  const originalEnv = process.env.MUNIN_MCP_BURST_PER_MIN;

  beforeEach(() => {
    process.env.MUNIN_MCP_BURST_PER_MIN = '3';
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MUNIN_MCP_BURST_PER_MIN;
    else process.env.MUNIN_MCP_BURST_PER_MIN = originalEnv;
  });

  it('allows calls under the per-minute cap and rejects the (N+1)th', () => {
    const guard = new McpBurstGuard();
    const ctx = makeContext(makeRequest('org_a'));
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(/mcp_burst_limited/);
  });

  it('isolates orgs from each other', () => {
    const guard = new McpBurstGuard();
    const a = makeContext(makeRequest('org_a'));
    const b = makeContext(makeRequest('org_b'));
    for (let i = 0; i < 3; i++) expect(guard.canActivate(a)).toBe(true);
    expect(() => guard.canActivate(a)).toThrow();
    expect(guard.canActivate(b)).toBe(true);
  });

  it('falls back to IP-based key for anonymous traffic', () => {
    const guard = new McpBurstGuard();
    const same = makeContext(makeRequest(null, '203.0.113.5'));
    const other = makeContext(makeRequest(null, '203.0.113.6'));
    for (let i = 0; i < 3; i++) expect(guard.canActivate(same)).toBe(true);
    expect(() => guard.canActivate(same)).toThrow();
    expect(guard.canActivate(other)).toBe(true);
  });

  it('disables enforcement when MUNIN_MCP_BURST_PER_MIN=0', () => {
    process.env.MUNIN_MCP_BURST_PER_MIN = '0';
    const guard = new McpBurstGuard();
    const ctx = makeContext(makeRequest('org_a'));
    for (let i = 0; i < 100; i++) expect(guard.canActivate(ctx)).toBe(true);
  });
});

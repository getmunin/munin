import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import {
  ActorIdentity,
  RequestContextStore,
  type ActorType,
  type RequestContext,
} from '@getmunin/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor.ts';
import type { RateLimitService } from '../rate-limit/rate-limit.service.ts';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function makeActiveContext(actorType: ActorType = 'user'): RequestContext {
  return {
    db: { execute: vi.fn().mockResolvedValue(undefined) } as never,
    actor: new ActorIdentity(actorType, 'actor_1', 'org_1', ['*'], ['admin']),
    correlationId: 'corr-1',
  };
}

function makeInterceptor(): {
  interceptor: AuditInterceptor;
  record: ReturnType<typeof vi.fn>;
  rateLimitRecord: ReturnType<typeof vi.fn>;
} {
  const rateLimitRecord = vi.fn().mockResolvedValue(1);
  const rateLimit = { record: rateLimitRecord } as unknown as RateLimitService;
  const interceptor = new AuditInterceptor(rateLimit);
  const record = vi.fn().mockResolvedValue(undefined);
  (interceptor as unknown as { audit: { record: typeof record } }).audit = { record };
  return { interceptor, record, rateLimitRecord };
}

describe('AuditInterceptor double-wrap guard', () => {
  it('records exactly one audit row even if the interceptor runs twice on the same request', async () => {
    const { interceptor, record } = makeInterceptor();
    const request = {
      method: 'GET',
      url: '/v1/whoami',
      headers: { 'user-agent': 'test' },
    };

    await RequestContextStore.run(makeActiveContext(), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(record).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/v1/agent-health',
    '/api/v1/agent-health',
    '/v1/widget/messages',
    '/v1/widget/conversations',
    '/v1/widget/conversations/ccv_abc123',
    '/v1/inbox',
    '/v1/usage/summary',
    '/v1/system/alerts',
    '/v1/agent-config',
  ])('skips audit for chatty GET %s', async (url) => {
    const { interceptor, record } = makeInterceptor();
    const request = { method: 'GET', url, headers: { 'user-agent': 'test' } };

    await RequestContextStore.run(makeActiveContext(), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(record).not.toHaveBeenCalled();
  });

  it('still audits non-polling GETs and all non-GETs on the same prefixes', async () => {
    const { interceptor, record } = makeInterceptor();
    const requests = [
      { method: 'GET', url: '/v1/whoami', headers: {} },
      { method: 'POST', url: '/v1/inbox', headers: {} },
      { method: 'DELETE', url: '/v1/agent-config/foo', headers: {} },
    ];

    await RequestContextStore.run(makeActiveContext(), async () => {
      for (const req of requests) {
        await firstValueFrom(interceptor.intercept(makeContext(req), makeNext(null)));
      }
    });

    expect(record).toHaveBeenCalledTimes(requests.length);
  });

  it('short-circuits anonymous requests (no active context)', async () => {
    const { interceptor, record } = makeInterceptor();
    const request = {
      method: 'GET',
      url: '/health',
      headers: {},
    };

    await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    expect(record).not.toHaveBeenCalled();
  });
});

describe('AuditInterceptor api_calls_day counter', () => {
  it('bumps the counter for non-user actors on non-MCP HTTP traffic', async () => {
    const { interceptor, rateLimitRecord } = makeInterceptor();
    const request = { method: 'GET', url: '/v1/whoami', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).toHaveBeenCalledTimes(1);
    expect(rateLimitRecord).toHaveBeenCalledWith('api_calls_day');
  });

  it('does not bump for dashboard browser (user) sessions', async () => {
    const { interceptor, rateLimitRecord } = makeInterceptor();
    const request = { method: 'GET', url: '/v1/whoami', headers: {} };

    await RequestContextStore.run(makeActiveContext('user'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).not.toHaveBeenCalled();
  });

  it.each(['POST', 'DELETE'])('does not bump for %s /mcp tool traffic', async (verb) => {
    const { interceptor, rateLimitRecord } = makeInterceptor();
    const request = { method: verb, url: '/mcp', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).not.toHaveBeenCalled();
  });

  it.each([
    '/v1/agent-health',
    '/v1/widget/messages',
    '/v1/inbox',
    '/v1/usage/summary',
  ])('does not bump for polling GET %s (mirrors existing tile semantics)', async (url) => {
    const { interceptor, rateLimitRecord } = makeInterceptor();
    const request = { method: 'GET', url, headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).not.toHaveBeenCalled();
  });

  it('bumps once even when the interceptor runs twice on the same request', async () => {
    const { interceptor, rateLimitRecord } = makeInterceptor();
    const request = { method: 'POST', url: '/v1/inbox', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).toHaveBeenCalledTimes(1);
  });
});

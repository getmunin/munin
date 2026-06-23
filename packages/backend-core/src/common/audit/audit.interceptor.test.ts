import { describe, expect, it, vi } from 'vitest';
import { defer, firstValueFrom, of, type Observable } from 'rxjs';
import {
  ActorIdentity,
  RequestContextStore,
  type ActorType,
  type RequestContext,
} from '@getmunin/core';
import type {
  CallHandler,
  ContextType,
  ExecutionContext,
  Type,
} from '@nestjs/common';
import type { Db } from '@getmunin/db';

type HttpArgumentsHost = ReturnType<ExecutionContext['switchToHttp']>;
type RpcArgumentsHost = ReturnType<ExecutionContext['switchToRpc']>;
type WsArgumentsHost = ReturnType<ExecutionContext['switchToWs']>;
import { AuditInterceptor } from './audit.interceptor.ts';
import { RateLimitService, type Bucket } from '../rate-limit/rate-limit.service.ts';
import {
  QuotasService,
  type QuotaResource,
} from '../quotas/quotas.service.ts';

class MockRateLimitService extends RateLimitService {
  override record = vi.fn<(bucket: Bucket) => Promise<number>>().mockResolvedValue(1);
  override consume = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}

class MockQuotasService extends QuotasService {
  recordCallMock = vi.fn<(kind: string, key?: string) => Promise<void>>().mockResolvedValue(undefined);
  assertCanAdd(_resource: QuotaResource): Promise<void> { return Promise.resolve(); }
  recordCall(kind: string, key?: string): Promise<void> { return this.recordCallMock(kind, key); }
  cap(_orgId: string, _resource: QuotaResource): Promise<number> { return Promise.resolve(Number.POSITIVE_INFINITY); }
  count(_resource: QuotaResource): Promise<number> { return Promise.resolve(0); }
}

class TestableAuditInterceptor extends AuditInterceptor {
  auditRecord = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  constructor(rateLimit: RateLimitService, quotas: QuotasService) {
    super(rateLimit, quotas);
    Object.defineProperty(this, 'audit', { value: { record: this.auditRecord } });
  }
}

class MockExecutionContext implements ExecutionContext {
  constructor(private readonly request: Record<string, unknown>) {}
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

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return new MockExecutionContext(request);
}

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function makeActiveContext(actorType: ActorType = 'user'): RequestContext {
  const db: Pick<Db, 'execute'> = { execute: vi.fn().mockResolvedValue(undefined) as Db['execute'] };
  return {
    db: db as Db,
    actor: new ActorIdentity(actorType, 'actor_1', 'org_1', ['*'], ['admin']),
    correlationId: 'corr-1',
  };
}

function makeInterceptor(
  recordCallImpl: (kind: string, key?: string) => Promise<void> = () => Promise.resolve(),
): {
  interceptor: TestableAuditInterceptor;
  rateLimit: MockRateLimitService;
  quotas: MockQuotasService;
} {
  const rateLimit = new MockRateLimitService();
  const quotas = new MockQuotasService();
  quotas.recordCallMock.mockImplementation(recordCallImpl);
  const interceptor = new TestableAuditInterceptor(rateLimit, quotas);
  return { interceptor, rateLimit, quotas };
}

describe('AuditInterceptor double-wrap guard', () => {
  it('records exactly one audit row even if the interceptor runs twice on the same request', async () => {
    const { interceptor } = makeInterceptor();
    const record = interceptor.auditRecord;
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
    const { interceptor } = makeInterceptor();
    const record = interceptor.auditRecord;
    const request = { method: 'GET', url, headers: { 'user-agent': 'test' } };

    await RequestContextStore.run(makeActiveContext(), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(record).not.toHaveBeenCalled();
  });

  it('still audits non-polling GETs and all non-GETs on the same prefixes', async () => {
    const { interceptor } = makeInterceptor();
    const record = interceptor.auditRecord;
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
    const { interceptor } = makeInterceptor();
    const record = interceptor.auditRecord;
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
    const { interceptor, rateLimit } = makeInterceptor();
    const rateLimitRecord = rateLimit.record;
    const request = { method: 'GET', url: '/v1/whoami', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).toHaveBeenCalledTimes(1);
    expect(rateLimitRecord).toHaveBeenCalledWith('api_calls_day');
  });

  it('does not bump for dashboard browser (user) sessions', async () => {
    const { interceptor, rateLimit } = makeInterceptor();
    const rateLimitRecord = rateLimit.record;
    const request = { method: 'GET', url: '/v1/whoami', headers: {} };

    await RequestContextStore.run(makeActiveContext('user'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).not.toHaveBeenCalled();
  });

  it.each(['POST', 'DELETE'])('does not bump for %s /mcp tool traffic', async (verb) => {
    const { interceptor, rateLimit } = makeInterceptor();
    const rateLimitRecord = rateLimit.record;
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
    const { interceptor, rateLimit } = makeInterceptor();
    const rateLimitRecord = rateLimit.record;
    const request = { method: 'GET', url, headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).not.toHaveBeenCalled();
  });

  it('bumps once even when the interceptor runs twice on the same request', async () => {
    const { interceptor, rateLimit } = makeInterceptor();
    const rateLimitRecord = rateLimit.record;
    const request = { method: 'POST', url: '/v1/inbox', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(rateLimitRecord).toHaveBeenCalledTimes(1);
  });
});

describe('AuditInterceptor token usage', () => {
  it('records totalTokens from the request context when a handler set it', async () => {
    const { interceptor } = makeInterceptor();
    const record = interceptor.auditRecord;
    const ctx = makeActiveContext('admin_agent');
    ctx.aiTokens = 1234;
    const request = {
      method: 'POST',
      url: '/v1/curator/jobs/cjob_1/acknowledge',
      headers: {},
    };

    await RequestContextStore.run(ctx, async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 1234 }));
  });

  it('records undefined totalTokens when the context has none', async () => {
    const { interceptor } = makeInterceptor();
    const record = interceptor.auditRecord;
    const request = { method: 'POST', url: '/v1/inbox', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: undefined }));
  });
});

describe('AuditInterceptor quota delegation', () => {
  it('calls quotas.recordCall("api_request") for non-user, non-MCP HTTP traffic', async () => {
    const { interceptor, quotas } = makeInterceptor();
    const quotasRecordCall = quotas.recordCallMock;
    const request = { method: 'POST', url: '/v1/inbox', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(quotasRecordCall).toHaveBeenCalledTimes(1);
    expect(quotasRecordCall).toHaveBeenCalledWith('api_request', 'POST /v1/inbox');
  });

  it('does not call quotas.recordCall for /mcp HTTP traffic', async () => {
    const { interceptor, quotas } = makeInterceptor();
    const quotasRecordCall = quotas.recordCallMock;
    const request = { method: 'POST', url: '/mcp', headers: {} };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(quotasRecordCall).not.toHaveBeenCalled();
  });

  it('does not call quotas.recordCall for dashboard browser sessions', async () => {
    const { interceptor, quotas } = makeInterceptor();
    const quotasRecordCall = quotas.recordCallMock;
    const request = { method: 'POST', url: '/v1/inbox', headers: {} };

    await RequestContextStore.run(makeActiveContext('user'), async () => {
      await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    });

    expect(quotasRecordCall).not.toHaveBeenCalled();
  });

  it('propagates errors from quotas.recordCall (cloud quota exceeded) without subscribing the handler', async () => {
    const quotaErr = new Error('quota_exceeded');
    const { interceptor } = makeInterceptor(() => Promise.reject(quotaErr));
    const request = { method: 'POST', url: '/v1/inbox', headers: {} };
    let subscribed = 0;
    const next: CallHandler = {
      handle: (): Observable<unknown> => defer(() => {
        subscribed += 1;
        return of(null);
      }),
    };

    await RequestContextStore.run(makeActiveContext('admin_agent'), async () => {
      await expect(
        firstValueFrom(interceptor.intercept(makeContext(request), next)),
      ).rejects.toBe(quotaErr);
    });

    expect(subscribed).toBe(0);
  });
});

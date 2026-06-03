import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor.ts';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function makeActiveContext(): RequestContext {
  return {
    db: { execute: vi.fn().mockResolvedValue(undefined) } as never,
    actor: new ActorIdentity('user', 'usr_1', 'org_1', ['*'], ['admin']),
    correlationId: 'corr-1',
  };
}

describe('AuditInterceptor double-wrap guard', () => {
  it('records exactly one audit row even if the interceptor runs twice on the same request', async () => {
    const interceptor = new AuditInterceptor();
    const record = vi.fn().mockResolvedValue(undefined);
    (interceptor as unknown as { audit: { record: typeof record } }).audit = { record };

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

  it('short-circuits anonymous requests (no active context)', async () => {
    const interceptor = new AuditInterceptor();
    const record = vi.fn().mockResolvedValue(undefined);
    (interceptor as unknown as { audit: { record: typeof record } }).audit = { record };

    const request = {
      method: 'GET',
      url: '/health',
      headers: {},
    };

    await firstValueFrom(interceptor.intercept(makeContext(request), makeNext(null)));
    expect(record).not.toHaveBeenCalled();
  });
});

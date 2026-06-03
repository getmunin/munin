import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { TenancyInterceptor } from './tenancy.interceptor.ts';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function makeActor(): ActorIdentity {
  return new ActorIdentity('user', 'usr_1', 'org_1', ['*'], ['admin']);
}

describe('TenancyInterceptor double-wrap guard', () => {
  it('opens a transaction on the first invocation', async () => {
    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ execute: vi.fn().mockResolvedValue(undefined) });
    });
    const db = { transaction } as never;
    const interceptor = new TenancyInterceptor(db);
    const request = { credential: { actor: makeActor() } };

    const result = await firstValueFrom(
      interceptor.intercept(makeContext(request), makeNext('handler-output')),
    );

    expect(result).toBe('handler-output');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('does NOT open a second transaction when a RequestContext is already active', async () => {
    const transaction = vi.fn();
    const db = { transaction } as never;
    const interceptor = new TenancyInterceptor(db);
    const request = { credential: { actor: makeActor() } };
    const outerCtx: RequestContext = {
      db: { transaction: vi.fn() } as never,
      actor: makeActor(),
      correlationId: 'outer-corr',
    };

    const result = await RequestContextStore.run(outerCtx, async () =>
      firstValueFrom(interceptor.intercept(makeContext(request), makeNext('handler-output'))),
    );

    expect(result).toBe('handler-output');
    expect(transaction).not.toHaveBeenCalled();
  });
});

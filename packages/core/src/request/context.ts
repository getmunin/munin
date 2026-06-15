import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Tx } from '@getmunin/db';

export type ActorType =
  | 'user'
  | 'admin_agent'
  | 'widget_agent'
  | 'end_user_agent'
  | 'partner'
  | 'system';

export type Audience = 'admin' | 'self_service';

export class ActorIdentity {
  constructor(
    public readonly type: ActorType,
    public readonly id: string,
    public readonly orgId: string,
    public readonly scopes: readonly string[],
    public readonly audiences: readonly Audience[],
    public readonly endUserId?: string,
    public readonly tokenId?: string,
    public readonly partnerId?: string,
    public readonly userId?: string,
  ) {}

  hasScope(scope: string): boolean {
    return this.scopes.includes(scope) || this.scopes.includes('*');
  }

  hasAudience(audience: Audience): boolean {
    return this.audiences.includes(audience);
  }
}

export interface RequestContext {
  db: Db | Tx;
  actor?: ActorIdentity;
  correlationId: string;
  afterCommit?: Array<() => void | Promise<void>>;
}

export const RequestContextStore = new AsyncLocalStorage<RequestContext>();

export function getCurrentContext(): RequestContext {
  const ctx = RequestContextStore.getStore();
  if (!ctx) {
    throw new Error(
      'getCurrentContext() called outside an active request — ' +
        'is the TenancyInterceptor wrapping this code path?',
    );
  }
  return ctx;
}

export async function withContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return RequestContextStore.run(ctx, fn);
}

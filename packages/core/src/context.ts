import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Tx } from '@munin/db';

/** Who is performing an action; stamped into every audit row. */
export type ActorType = 'user' | 'admin_agent' | 'end_user_agent' | 'partner' | 'system';

/** Tool surfaces a token can call. */
export type Audience = 'admin' | 'self_service';

/**
 * Identity of the caller. Resolved by AuthGuard from a bearer token /
 * API key. `endUserId` is set only for delegated end-user tokens; it
 * additionally constrains row-level filters to that user's data.
 */
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

/**
 * Per-request data stored in AsyncLocalStorage so any service called during
 * the request can read it without explicit threading.
 */
export interface RequestContext {
  /**
   * Drizzle client bound to the request's transaction. The transaction-scoped
   * shape (`Tx`) is the typical value — TenancyInterceptor wraps every
   * request in `db.transaction(...)`. We accept `Db` too so service-role
   * background paths (signup, workers) can pass the pool directly.
   */
  db: Db | Tx;
  /** Who is calling. Undefined for unauthenticated routes (signup, oauth). */
  actor?: ActorIdentity;
  /** Stable id linking all audit rows + events for this request. */
  correlationId: string;
}

/** AsyncLocalStorage holder, exported as a singleton. */
export const RequestContextStore = new AsyncLocalStorage<RequestContext>();

/**
 * Read the current request context. Throws if called outside a request
 * — services should never run outside the interceptor's wrapper in a
 * Munin codepath.
 */
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

/**
 * Run `fn` with a freshly-created request context. Used by the
 * TenancyInterceptor and by tests / scripts that need to simulate one.
 */
export async function withContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return RequestContextStore.run(ctx, fn);
}

import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { sql } from 'drizzle-orm';
import { RequestContextStore, type RequestContext } from '@munin/core';
import type { Db } from '@munin/db';
import { DB } from '../db/db.module.js';
import { randomUUID } from 'node:crypto';

/**
 * Wrap each request in a Postgres transaction with `app.org_id` (and
 * optionally `app.end_user_id`) GUCs set, so RLS policies enforce tenancy.
 *
 * Runs after AuthGuard so `request.credential` is available. For routes
 * marked `@AllowAnonymous` and lacking a credential, we skip the transaction
 * entirely; those routes shouldn't touch tenant tables anyway.
 *
 * Critical Scaleway Postgres pooler note: pooler is transaction-mode, so
 * `set_config(name, value, true)` (true = local to txn) works. We use the
 * function form rather than `SET LOCAL` so it's a normal parameterized
 * statement instead of a literal SQL fragment.
 */
@Injectable()
export class TenancyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      credential?: { actor: import('@munin/core').ActorIdentity };
      correlationId?: string;
    }>();
    const correlationId = request.correlationId ?? randomUUID();
    request.correlationId = correlationId;

    const credential = request.credential;

    // Anonymous request: pass through with no transaction. Routes that need
    // DB access for these (e.g. signup) should explicitly use the service-role
    // Db, not the request-bound one.
    if (!credential) {
      return next.handle();
    }

    return from(this.runInTransaction(credential.actor, correlationId, next)).pipe(
      switchMap((value) => from(Promise.resolve(value))),
    );
  }

  private async runInTransaction(
    actor: import('@munin/core').ActorIdentity,
    correlationId: string,
    next: CallHandler,
  ): Promise<unknown> {
    return this.db.transaction(async (tx) => {
      // Set GUCs scoped to this transaction.
      // The connection has session-level `app.bypass_rls=on` (service role);
      // we override it here so RLS policies apply within the request.
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      if (actor.orgId) {
        await tx.execute(sql`SELECT set_config('app.org_id', ${actor.orgId}, true)`);
      }
      if (actor.endUserId) {
        await tx.execute(sql`SELECT set_config('app.end_user_id', ${actor.endUserId}, true)`);
      }

      const ctx: RequestContext = { db: tx as unknown as Db, actor, correlationId };
      return RequestContextStore.run(ctx, async () => {
        // Convert the Observable from next.handle() into a Promise inside the txn.
        return new Promise((resolve, reject) => {
          next.handle().subscribe({
            next: (val) => resolve(val),
            error: (err) => reject(err),
          });
        });
      });
    });
  }
}

import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { sql } from 'drizzle-orm';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import { DB } from '../db/db.module.js';
import { randomUUID } from 'node:crypto';

interface RequestWithAuth {
  credential?: { actor: ActorIdentity };
  correlationId?: string;
}

async function applyTenancyGUCs(tx: Db | Tx, actor: ActorIdentity): Promise<void> {
  await applyEncryptionKeyGUC(tx);
  await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
  if (actor.orgId) {
    await tx.execute(sql`SELECT set_config('app.org_id', ${actor.orgId}, true)`);
  }
  if (actor.endUserId) {
    await tx.execute(sql`SELECT set_config('app.end_user_id', ${actor.endUserId}, true)`);
  }
}

/**
 * Set `app.crypt_key` for the current transaction so SQL fragments wrapping
 * pgcrypto's pgp_sym_encrypt / pgp_sym_decrypt can pick it up via
 * current_setting. Silently no-ops when MUNIN_ENCRYPTION_KEY is unset —
 * encryption-aware code paths surface a clear error at use time.
 */
async function applyEncryptionKeyGUC(tx: Db | Tx): Promise<void> {
  const key = process.env.MUNIN_ENCRYPTION_KEY;
  if (!key) return;
  await tx.execute(sql`SELECT set_config('app.crypt_key', ${key}, true)`);
}

function awaitNextHandler(next: CallHandler): Promise<unknown> {
  return new Promise((resolve, reject) => {
    next.handle().subscribe({ next: resolve, error: reject });
  });
}

@Injectable()
export class TenancyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const correlationId = request.correlationId ?? randomUUID();
    request.correlationId = correlationId;

    if (!request.credential) {
      return next.handle();
    }

    return from(this.runRequestInTenantTransaction(request.credential.actor, correlationId, next)).pipe(
      switchMap((value) => from(Promise.resolve(value))),
    );
  }

  private async runRequestInTenantTransaction(
    actor: ActorIdentity,
    correlationId: string,
    next: CallHandler,
  ): Promise<unknown> {
    return this.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      const ctx: RequestContext = { db: tx, actor, correlationId };
      return RequestContextStore.run(ctx, () => awaitNextHandler(next));
    });
  }
}

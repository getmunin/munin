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
import { DB } from '../db/db.module.ts';
import { randomUUID } from 'node:crypto';

interface RequestWithAuth {
  credential?: { actor: ActorIdentity };
  correlationId?: string;
}

export async function applyTenancyGUCs(tx: Db | Tx, actor: ActorIdentity): Promise<void> {
  if (actor.type === 'partner') {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return;
  }
  await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
  if (actor.orgId) {
    await tx.execute(sql`SELECT set_config('app.org_id', ${actor.orgId}, true)`);
  }
  if (actor.endUserId) {
    await tx.execute(sql`SELECT set_config('app.end_user_id', ${actor.endUserId}, true)`);
    if (actor.conversationId) await applyKbSpaceScopeGUC(tx, actor.conversationId);
  }
}

async function applyKbSpaceScopeGUC(tx: Db | Tx, conversationId: string): Promise<void> {
  await tx.execute(sql`
    SELECT set_config(
      'app.kb_space_ids',
      COALESCE(
        (
          SELECT string_agg(s.space_id, ',')
          FROM conv_channel_kb_spaces s
          JOIN conv_conversations c ON c.channel_id = s.channel_id
          WHERE c.id = ${conversationId}
        ),
        ''
      ),
      true
    )
  `);
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
    if (RequestContextStore.getStore()) {
      return next.handle();
    }
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
    const afterCommit: NonNullable<RequestContext['afterCommit']> = [];
    const result = await this.db.transaction(async (tx) => {
      await applyTenancyGUCs(tx, actor);
      const ctx: RequestContext = { db: tx, actor, correlationId, afterCommit };
      return RequestContextStore.run(ctx, () => awaitNextHandler(next));
    });
    for (const cb of afterCommit) {
      await cb();
    }
    return result;
  }
}

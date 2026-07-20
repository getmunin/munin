import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import {
  ActorIdentity,
  getCurrentContext,
  hashSecret,
  randomToken,
  setEncryptionKeySql,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import {
  CredentialTargetRegistry,
  type CredentialApplyResult,
  type CredentialFieldSpec,
} from './credential-target.ts';
import { credentialLinkUrl } from './credential-handoff.constants.ts';

export interface CredentialLink {
  url: string;
  expiresAt: string;
}

export interface PendingCredentialDto {
  label: string;
  vendor: string;
  fields: CredentialFieldSpec[];
}

const LINK_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CredentialHandoffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CredentialTargetRegistry) private readonly registry: CredentialTargetRegistry,
  ) {}

  /**
   * Mint a one-time link for a target that already exists. Runs in the
   * caller's authed context; the target's owning module validates targetId.
   */
  async mint(args: { targetType: string; targetId: string }): Promise<CredentialLink> {
    const ctx = getCurrentContext();
    if (!this.registry.get(args.targetType)) {
      throw new BadRequestException(`credential_handoff_invalid: unknown target ${args.targetType}`);
    }
    const raw = `mncl_${randomToken(32)}`;
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await ctx.db.insert(schema.credentialRequests).values({
      orgId: ctx.actor!.orgId,
      targetType: args.targetType,
      targetId: args.targetId,
      linkHash: hashSecret(raw),
      expiresAt,
    });
    return { url: credentialLinkUrl(raw), expiresAt: expiresAt.toISOString() };
  }

  async describe(token: string): Promise<PendingCredentialDto> {
    const req = await this.resolve(token);
    const handler = this.registry.get(req.targetType);
    if (!handler) throw new NotFoundException('credential_handoff_not_found: link no longer valid');
    const description = await this.inOrgContext(req.orgId, () => handler.describe(req.targetId));
    if (!description) {
      throw new NotFoundException('credential_handoff_not_found: link no longer valid');
    }
    return description;
  }

  async complete(token: string, secrets: Record<string, string>): Promise<CredentialApplyResult> {
    const req = await this.resolve(token);
    const handler = this.registry.get(req.targetType);
    if (!handler) throw new NotFoundException('credential_handoff_not_found: link no longer valid');
    const result = await this.inOrgContext(req.orgId, () => handler.apply(req.targetId, secrets));
    await this.db
      .update(schema.credentialRequests)
      .set({ completedAt: new Date() })
      .where(eq(schema.credentialRequests.id, req.id));
    return result;
  }

  private async resolve(token: string) {
    if (!token || !token.startsWith('mncl_')) {
      throw new NotFoundException('credential_handoff_not_found: invalid or expired link');
    }
    const rows = await this.db
      .select()
      .from(schema.credentialRequests)
      .where(
        and(
          eq(schema.credentialRequests.linkHash, hashSecret(token)),
          isNull(schema.credentialRequests.completedAt),
          gt(schema.credentialRequests.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const req = rows[0];
    if (!req) throw new NotFoundException('credential_handoff_not_found: invalid or expired link');
    return req;
  }

  private async inOrgContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx.execute(setEncryptionKeySql());
      const actor = new ActorIdentity('system', 'credential-handoff', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, fn);
    });
  }
}

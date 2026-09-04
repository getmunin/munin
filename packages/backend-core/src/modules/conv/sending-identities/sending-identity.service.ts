import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import {
  dkimDnsRecord,
  domainCoversAddress,
  generateDkimKeyPair,
  normaliseDomain,
  type SendingIdentityDnsRecord,
} from './dkim-key.ts';
import {
  SENDING_IDENTITY_PROVIDER,
  type SendingIdentityProvider,
  type SendingIdentityStatus,
} from './provider.ts';

export interface SendingIdentityDto {
  id: string;
  domain: string;
  selector: string;
  status: SendingIdentityStatus;
  provider: string;
  records: SendingIdentityDnsRecord[];
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

type IdentityRow = typeof schema.convSendingIdentities.$inferSelect;

@Injectable()
export class SendingIdentityService {
  private readonly logger = new Logger(SendingIdentityService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SENDING_IDENTITY_PROVIDER) private readonly provider: SendingIdentityProvider,
  ) {}

  async create(input: { domain: string }): Promise<SendingIdentityDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const domain = normaliseDomain(input.domain);
    if (!domain) {
      throw new BadRequestException(
        `conv_invalid: "${input.domain}" is not a domain — pass the domain alone, e.g. acme.com, not an email address`,
      );
    }

    const existing = await ctx.db
      .select({ id: schema.convSendingIdentities.id })
      .from(schema.convSendingIdentities)
      .where(
        and(
          eq(schema.convSendingIdentities.orgId, orgId),
          eq(schema.convSendingIdentities.domain, domain),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new ConflictException(`conv_conflict: ${domain} already has a sending identity`);
    }

    const pair = generateDkimKeyPair();
    const provisioned = await this.provider.provision({
      domain,
      selector: pair.selector,
      privateKeyPem: pair.privateKeyPem,
      publicKeyPem: pair.publicKeyPem,
    });

    await ctx.db.execute(setEncryptionKeySql());
    const encrypted = await ctx.db.execute<{ ct: string } & Record<string, unknown>>(
      sql`SELECT ${encryptSecretSql(pair.privateKeyPem)} AS ct`,
    );
    const ct = encrypted[0]?.ct;
    if (!ct) throw new Error('sending identity key encryption failed');

    const [row] = await ctx.db
      .insert(schema.convSendingIdentities)
      .values({
        orgId,
        domain,
        selector: pair.selector,
        privateKeyPem: ct,
        publicKeyPem: pair.publicKeyPem,
        provider: this.provider.name,
        providerRef: provisioned.providerRef,
        status: 'pending',
      })
      .returning();

    return this.toDto(row!, provisioned.extraRecords);
  }

  async list(): Promise<SendingIdentityDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.orgId, ctx.actor!.orgId));
    return rows.map((row) => this.toDto(row));
  }

  async refresh(identityId: string): Promise<SendingIdentityDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, identityId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`sending identity ${identityId} not found`);

    const result = await this.checkOne(row);
    const [updated] = await ctx.db
      .update(schema.convSendingIdentities)
      .set(this.statusPatch(row, result))
      .where(eq(schema.convSendingIdentities.id, row.id))
      .returning();
    return this.toDto(updated!);
  }

  async remove(identityId: string): Promise<{ deleted: true }> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, identityId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`sending identity ${identityId} not found`);

    try {
      await this.provider.revoke({ domain: row.domain, providerRef: row.providerRef });
    } catch (err) {
      this.logger.warn(
        `provider revoke failed for ${row.domain}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await ctx.db
      .delete(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, row.id));
    return { deleted: true };
  }

  async checkOne(row: IdentityRow): Promise<{ status: SendingIdentityStatus; detail?: string }> {
    return this.provider.refresh({
      domain: row.domain,
      selector: row.selector,
      publicKeyPem: row.publicKeyPem,
      providerRef: row.providerRef,
    });
  }

  statusPatch(
    row: IdentityRow,
    result: { status: SendingIdentityStatus; detail?: string },
  ): Partial<typeof schema.convSendingIdentities.$inferInsert> {
    const now = new Date();
    return {
      status: result.status,
      lastError: result.status === 'verified' ? null : (result.detail ?? null),
      lastCheckedAt: now,
      verifiedAt: result.status === 'verified' ? (row.verifiedAt ?? now) : null,
      updatedAt: now,
    };
  }

  async loadPrivateKey(tx: Db | Tx, identityId: string): Promise<string | null> {
    const rows = await tx
      .select({ ct: schema.convSendingIdentities.privateKeyPem })
      .from(schema.convSendingIdentities)
      .where(eq(schema.convSendingIdentities.id, identityId))
      .limit(1);
    const ct = rows[0]?.ct;
    if (!ct) return null;
    await tx.execute(setEncryptionKeySql());
    const decrypted = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ct)} AS pt`,
    );
    return decrypted[0]?.pt ?? null;
  }

  toDto(row: IdentityRow, extraRecords?: SendingIdentityDnsRecord[]): SendingIdentityDto {
    return {
      id: row.id,
      domain: row.domain,
      selector: row.selector,
      status: row.status as SendingIdentityStatus,
      provider: row.provider,
      records: [dkimDnsRecord(row.selector, row.domain, row.publicKeyPem), ...(extraRecords ?? [])],
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastError: row.lastError,
    };
  }
}

export async function loadSigningKeyForAddress(
  tx: Db | Tx,
  orgId: string,
  address: string,
): Promise<{ domain: string; selector: string; privateKeyPem: string } | null> {
  const identity = await findVerifiedIdentityForAddress(tx, orgId, address);
  if (!identity) return null;
  await tx.execute(setEncryptionKeySql());
  const decrypted = await tx.execute<{ pt: string } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(identity.privateKeyPem)} AS pt`,
  );
  const pt = decrypted[0]?.pt;
  if (!pt) return null;
  return { domain: identity.domain, selector: identity.selector, privateKeyPem: pt };
}

export async function findVerifiedIdentityForAddress(
  tx: Db | Tx,
  orgId: string,
  address: string,
): Promise<IdentityRow | null> {
  const rows = await tx
    .select()
    .from(schema.convSendingIdentities)
    .where(
      and(
        eq(schema.convSendingIdentities.orgId, orgId),
        eq(schema.convSendingIdentities.status, 'verified'),
      ),
    );
  return rows.find((row) => domainCoversAddress(row.domain, address)) ?? null;
}

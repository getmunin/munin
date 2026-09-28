import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { getCurrentContext, readApiBaseUrl, type AssetStorage } from '@getmunin/core';
import { DB } from '../common/db/db.module.ts';
import { STORAGE } from '../common/storage/storage.token.ts';
import { normalizeMime, randomKeySegment } from '../common/storage/asset-validation.ts';

export const ORG_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const LOGO_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export interface OrgLogoFields {
  id: string;
  logoStorageKey: string | null;
  logoUpdatedAt: Date | null;
}

export interface StoredOrgLogo {
  mime: string;
  bytes: Buffer;
}

export function orgLogoTooLarge(): BadRequestException {
  return new BadRequestException({
    message: `org_logo_too_large: logo exceeds ${ORG_LOGO_MAX_BYTES} bytes`,
    code: 'org_logo_too_large',
  });
}

function unsupportedType(detail: string): BadRequestException {
  return new BadRequestException({
    message: `org_logo_unsupported_type: ${detail}; use PNG, JPEG, WebP or SVG`,
    code: 'org_logo_unsupported_type',
  });
}

@Injectable()
export class OrgLogoService {
  private readonly logger = new Logger(OrgLogoService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: AssetStorage,
  ) {}

  logoUrl(org: OrgLogoFields): string | null {
    if (!org.logoStorageKey || !org.logoUpdatedAt) return null;
    return `${readApiBaseUrl()}/v1/public/orgs/${encodeURIComponent(org.id)}/logo?v=${org.logoUpdatedAt.getTime()}`;
  }

  async upload(rawMime: string | undefined, bytes: Buffer): Promise<typeof schema.orgs.$inferSelect> {
    const mime = normalizeMime(rawMime ?? '');
    const ext = LOGO_EXTENSIONS[mime];
    if (!ext) throw unsupportedType(`content type ${mime || '(none)'} is not accepted`);
    if (bytes.length === 0) throw unsupportedType('the upload is empty');
    if (bytes.length > ORG_LOGO_MAX_BYTES) throw orgLogoTooLarge();
    if (!contentMatchesMime(mime, bytes)) {
      throw unsupportedType(`the file content is not a valid ${ext.toUpperCase()} image`);
    }
    if (!this.storage.writeDirect) {
      throw new Error('asset storage does not support direct writes');
    }

    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const previous = await this.currentKey(orgId);
    const key = `orgs/${orgId}/logo/${randomKeySegment()}.${ext}`;
    await this.storage.writeDirect(key, bytes, { mime });

    const now = new Date();
    const [updated] = await ctx.db
      .update(schema.orgs)
      .set({ logoStorageKey: key, logoMime: mime, logoUpdatedAt: now, updatedAt: now })
      .where(eq(schema.orgs.id, orgId))
      .returning();
    if (previous) await this.deleteQuietly(previous);
    return updated!;
  }

  async remove(): Promise<typeof schema.orgs.$inferSelect> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const previous = await this.currentKey(orgId);
    const [updated] = await ctx.db
      .update(schema.orgs)
      .set({ logoStorageKey: null, logoMime: null, logoUpdatedAt: null, updatedAt: new Date() })
      .where(eq(schema.orgs.id, orgId))
      .returning();
    if (previous) await this.deleteQuietly(previous);
    return updated!;
  }

  async read(orgId: string): Promise<StoredOrgLogo | null> {
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx
        .select({ key: schema.orgs.logoStorageKey, mime: schema.orgs.logoMime })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, orgId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!row?.key || !row.mime) return null;
    const bytes = await this.storage.readBytes(row.key);
    if (!bytes) return null;
    return { mime: row.mime, bytes };
  }

  private async currentKey(orgId: string): Promise<string | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ key: schema.orgs.logoStorageKey })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    return rows[0]?.key ?? null;
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`failed to delete replaced org logo ${key}: ${String(err)}`);
    }
  }
}

export function contentMatchesMime(mime: string, bytes: Buffer): boolean {
  switch (mime) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      return (
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'image/svg+xml':
      return looksLikeSvg(bytes);
    default:
      return false;
  }
}

function looksLikeSvg(bytes: Buffer): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return /<svg[\s>]/i.test(text);
}

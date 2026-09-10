import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import type { AssetVariant } from '@getmunin/types';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import {
  describeError,
  getCurrentContext,
  readApiBaseUrl,
  signAttachmentToken,
  type AssetStorage,
} from '@getmunin/core';
import { QUOTAS_SERVICE, type QuotasService } from '../../../common/quotas/quotas.service.ts';
import { STORAGE } from '../../../common/storage/storage.token.ts';
import {
  assetExtensionFromName,
  isSvgAsset,
  normalizeMime,
  randomKeySegment,
} from '../../../common/storage/asset-validation.ts';
import { deriveVariantColumns } from '../../cms/cms.variants.ts';
import {
  CONV_ATTACHMENT_BYTES_MAX,
  CONV_ATTACHMENT_MIME_ALLOWLIST,
  CONV_ATTACHMENT_PENDING_PER_SESSION_MAX,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
} from './conv-attachments.constants.ts';
import type {
  AttachmentDto,
  AttachmentUploadHandle,
  HydratedMessageAttachment,
  MessageAttachmentProjection,
} from './conv-attachments.types.ts';

type AttachmentRow = typeof schema.convAttachments.$inferSelect;

@Injectable()
export class ConvAttachmentsService {
  private readonly logger = new Logger(ConvAttachmentsService.name);

  constructor(
    @Inject(STORAGE) private readonly storage: AssetStorage,
    @Inject(QUOTAS_SERVICE) private readonly quotas: QuotasService,
  ) {}

  async requestUpload(input: {
    conversationId: string;
    name: string;
    mime: string;
    sizeBytes: number;
    sessionId?: string;
  }): Promise<AttachmentUploadHandle> {
    this.assertMime(input.mime, input.name);
    this.assertSize(input.sizeBytes);
    await this.assertConversationExists(input.conversationId);
    if (input.sessionId) await this.assertPendingSessionBudget(input.sessionId);
    await this.quotas.assertCanAdd('conv_attachments');

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const key = this.storageKeyFor(actor.orgId, input.conversationId, input.name);
    const presigned = await this.storage.presignedUpload({
      key,
      mime: normalizeMime(input.mime),
      sizeBytes: input.sizeBytes,
    });

    const [row] = await ctx.db
      .insert(schema.convAttachments)
      .values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        name: input.name,
        mime: normalizeMime(input.mime),
        sizeBytes: input.sizeBytes,
        sessionId: input.sessionId ?? null,
        storageProvider: this.storage.provider,
        storageKey: key,
        uploaded: false,
        createdByType: actor.type === 'user' ? 'user' : 'agent',
        createdById: actor.id,
      })
      .returning();

    return {
      ...this.toDto(row!),
      uploadUrl: presigned.uploadUrl,
      uploadMethod: presigned.uploadMethod,
      uploadFields: presigned.uploadFields,
      uploadExpiresAt: presigned.expiresAt.toISOString(),
    };
  }

  async completeUpload(input: { id: string; sessionId?: string }): Promise<AttachmentDto> {
    const ctx = getCurrentContext();
    const existing = await this.loadRow(input.id);
    if (existing.deletedAt) {
      throw new ConflictException(`conv_attachment_deleted: attachment ${input.id} was deleted`);
    }
    if (input.sessionId && existing.sessionId !== input.sessionId) {
      throw new NotFoundException(`conv_not_found: attachment ${input.id}`);
    }
    if (!existing.storageKey) {
      throw new ConflictException(`conv_attachment_conflict: attachment ${input.id} has no object`);
    }
    if (existing.uploaded) return this.toDto(existing);

    const actualBytes = await this.storage.statBytes(existing.storageKey);
    if (actualBytes == null) {
      throw new BadRequestException({
        message: `conv_attachment_upload_missing: object for attachment ${input.id} not found in storage`,
        code: 'conv_attachment_upload_missing',
      });
    }
    if (actualBytes !== existing.sizeBytes) {
      await this.purgeObjects(existing);
      await ctx.db.delete(schema.convAttachments).where(eq(schema.convAttachments.id, input.id));
      throw new BadRequestException({
        message: `conv_attachment_size_mismatch: declared ${existing.sizeBytes} bytes, uploaded ${actualBytes}`,
        code: 'conv_attachment_size_mismatch',
      });
    }

    const body = await this.storage.readBytes(existing.storageKey);
    const derived = body
      ? await this.deriveVariantsOrDefer(existing.mime, existing.storageKey, body)
      : {};

    const [row] = await ctx.db
      .update(schema.convAttachments)
      .set({ uploaded: true, ...derived, updatedAt: new Date() })
      .where(eq(schema.convAttachments.id, input.id))
      .returning();
    if (!row) throw new NotFoundException(`conv_not_found: attachment ${input.id}`);
    return this.toDto(row);
  }

  async persistBytes(input: {
    conversationId: string;
    messageId?: string;
    name: string;
    mime: string;
    body: Buffer;
    inline?: boolean;
    contentId?: string | null;
  }): Promise<AttachmentDto> {
    this.assertMime(input.mime, input.name);
    this.assertSize(input.body.length);
    await this.quotas.assertCanAdd('conv_attachments');
    if (!this.storage.writeDirect) {
      throw new Error('storage backend does not support direct writes');
    }

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const mime = normalizeMime(input.mime);
    const key = this.storageKeyFor(actor.orgId, input.conversationId, input.name);
    await this.storage.writeDirect(key, input.body, { mime });
    const derived = await this.deriveVariantsOrDefer(mime, key, input.body);

    const [row] = await ctx.db
      .insert(schema.convAttachments)
      .values({
        orgId: actor.orgId,
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        name: input.name,
        mime,
        sizeBytes: input.body.length,
        ...derived,
        storageProvider: this.storage.provider,
        storageKey: key,
        inline: input.inline ?? false,
        contentId: input.contentId ?? null,
        uploaded: true,
        createdByType: actor.type === 'user' ? 'user' : 'agent',
        createdById: actor.id,
      })
      .returning();
    return this.toDto(row!);
  }

  async attachToMessage(input: {
    messageId: string;
    conversationId: string;
    attachmentIds: readonly string[];
    sessionId?: string;
  }): Promise<AttachmentDto[]> {
    if (input.attachmentIds.length === 0) return [];
    if (input.attachmentIds.length > CONV_ATTACHMENT_PER_MESSAGE_MAX) {
      throw new BadRequestException({
        message: `conv_attachment_too_many: at most ${CONV_ATTACHMENT_PER_MESSAGE_MAX} attachments per message`,
        code: 'conv_attachment_too_many',
      });
    }
    const unique = [...new Set(input.attachmentIds)];
    const ctx = getCurrentContext();

    const rows = await ctx.db
      .select()
      .from(schema.convAttachments)
      .where(inArray(schema.convAttachments.id, unique));

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const row = byId.get(id);
      if (!row) throw new NotFoundException(`conv_not_found: attachment ${id}`);
      if (row.conversationId !== input.conversationId) {
        throw new BadRequestException({
          message: `conv_attachment_conflict: attachment ${id} belongs to another conversation`,
          code: 'conv_attachment_conflict',
        });
      }
      if (row.deletedAt) {
        throw new ConflictException(`conv_attachment_deleted: attachment ${id} was deleted`);
      }
      if (!row.uploaded) {
        throw new ConflictException(
          `conv_attachment_conflict: attachment ${id} upload was never completed`,
        );
      }
      if (row.messageId && row.messageId !== input.messageId) {
        throw new ConflictException(
          `conv_attachment_conflict: attachment ${id} is already on message ${row.messageId}`,
        );
      }
      if (input.sessionId && row.sessionId !== input.sessionId) {
        throw new NotFoundException(`conv_not_found: attachment ${id}`);
      }
    }

    const updated = await ctx.db
      .update(schema.convAttachments)
      .set({ messageId: input.messageId, updatedAt: new Date() })
      .where(inArray(schema.convAttachments.id, unique))
      .returning();
    return updated.map((r) => this.toDto(r));
  }

  async listForMessages(messageIds: readonly string[]): Promise<Map<string, AttachmentDto[]>> {
    const out = new Map<string, AttachmentDto[]>();
    if (messageIds.length === 0) return out;
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convAttachments)
      .where(inArray(schema.convAttachments.messageId, [...new Set(messageIds)]));
    for (const row of rows) {
      if (!row.messageId) continue;
      const list = out.get(row.messageId) ?? [];
      list.push(this.toDto(row));
      out.set(row.messageId, list);
    }
    return out;
  }

  async delete(input: { id: string }): Promise<{ deleted: true; id: string; alreadyDeleted: boolean }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.loadRow(input.id);
    if (existing.deletedAt) {
      return { deleted: true, id: input.id, alreadyDeleted: true };
    }

    await this.purgeObjects(existing);

    if (!existing.messageId) {
      await ctx.db.delete(schema.convAttachments).where(eq(schema.convAttachments.id, input.id));
      return { deleted: true, id: input.id, alreadyDeleted: false };
    }

    await ctx.db
      .update(schema.convAttachments)
      .set({
        deletedAt: new Date(),
        deletedByType: actor.type === 'user' ? 'user' : 'agent',
        deletedById: actor.id,
        storageKey: null,
        variants: [],
        updatedAt: new Date(),
      })
      .where(eq(schema.convAttachments.id, input.id));
    return { deleted: true, id: input.id, alreadyDeleted: false };
  }

  projectForMessage(rows: readonly AttachmentDto[]): MessageAttachmentProjection[] {
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      sizeBytes: r.sizeBytes,
      width: r.width,
      height: r.height,
      thumbnailWidth: r.thumbnailWidth,
      inline: r.inline,
      cid: r.contentId,
      deleted: r.deleted,
    }));
  }

  hydrateProjection(
    orgId: string,
    rows: readonly MessageAttachmentProjection[],
  ): HydratedMessageAttachment[] {
    return rows.map((r) => ({
      ...r,
      url: r.deleted ? null : this.signUrl(orgId, r.id),
      thumbnailUrl: r.deleted ? null : this.signUrl(orgId, r.id, r.thumbnailWidth),
    }));
  }

  toDto(row: AttachmentRow): AttachmentDto {
    const deleted = row.deletedAt != null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      messageId: row.messageId,
      name: row.name,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      inline: row.inline,
      contentId: row.contentId,
      uploaded: row.uploaded,
      thumbnailWidth: smallestVariant(row.variants),
      url: deleted ? null : this.signUrl(row.orgId, row.id),
      thumbnailUrl: deleted ? null : this.signUrl(row.orgId, row.id, smallestVariant(row.variants)),
      deleted,
      createdAt: row.createdAt.toISOString(),
    };
  }

  signUrl(orgId: string, attachmentId: string, variantWidth?: number | null): string | null {
    let token: string;
    try {
      token = signAttachmentToken({ orgId, attachmentId });
    } catch {
      return null;
    }
    const base = `${readApiBaseUrl()}/v1/c/a/${token}`;
    return variantWidth ? `${base}?w=${variantWidth}` : base;
  }

  private async purgeObjects(row: AttachmentRow): Promise<void> {
    const keys = [row.storageKey, ...row.variants.map((v) => v.storageKey)].filter(
      (k): k is string => !!k,
    );
    for (const key of keys) {
      await this.storage.delete(key).catch((err: unknown) => {
        this.logger.warn(
          `could not purge attachment object ${key} for ${row.id}: ${describeError(err)}`,
        );
      });
    }
  }

  private storageKeyFor(orgId: string, conversationId: string, name: string): string {
    const ext = assetExtensionFromName(name);
    return `conv/${orgId}/${conversationId}/${randomKeySegment()}.${ext}`;
  }

  private assertMime(mime: string, name: string): void {
    const normalized = normalizeMime(mime);
    const ext = assetExtensionFromName(name);
    if (isSvgAsset(ext, normalized)) {
      throw new BadRequestException({
        message:
          'conv_attachment_mime_rejected: svg attachments are not allowed: SVG can carry inline scripts that execute in the browser',
        code: 'conv_attachment_mime_rejected',
      });
    }
    if (!CONV_ATTACHMENT_MIME_ALLOWLIST.includes(normalized)) {
      throw new BadRequestException({
        message: `conv_attachment_mime_rejected: "${normalized}" is not an accepted attachment type (${CONV_ATTACHMENT_MIME_ALLOWLIST.join(', ')})`,
        code: 'conv_attachment_mime_rejected',
      });
    }
  }

  private assertSize(sizeBytes: number): void {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException({
        message: 'conv_attachment_invalid: sizeBytes must be positive',
        code: 'conv_attachment_invalid',
      });
    }
    if (sizeBytes > CONV_ATTACHMENT_BYTES_MAX) {
      throw new BadRequestException({
        message: `conv_attachment_too_large: attachment exceeds the ${Math.floor(CONV_ATTACHMENT_BYTES_MAX / (1024 * 1024))}MB limit`,
        code: 'conv_attachment_too_large',
      });
    }
  }

  private async assertConversationExists(conversationId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convConversations.id })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`conv_not_found: conversation ${conversationId}`);
  }

  private async assertPendingSessionBudget(sessionId: string): Promise<void> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ pending: count() })
      .from(schema.convAttachments)
      .where(
        and(
          eq(schema.convAttachments.sessionId, sessionId),
          isNull(schema.convAttachments.messageId),
          isNull(schema.convAttachments.deletedAt),
        ),
      );
    if ((row?.pending ?? 0) >= CONV_ATTACHMENT_PENDING_PER_SESSION_MAX) {
      throw new ConflictException({
        message: `conv_attachment_too_many: at most ${CONV_ATTACHMENT_PENDING_PER_SESSION_MAX} pending uploads per session`,
        code: 'conv_attachment_too_many',
      });
    }
  }

  private async loadRow(id: string): Promise<AttachmentRow> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convAttachments)
      .where(eq(schema.convAttachments.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`conv_not_found: attachment ${id}`);
    return rows[0];
  }

  private async deriveVariantsOrDefer(
    mime: string,
    storageKey: string,
    body: Buffer,
  ): Promise<{ width?: number | null; height?: number | null; variants?: AssetVariant[] }> {
    try {
      const { width, height, variants } = await deriveVariantColumns(this.storage, {
        mime,
        storageKey,
        body,
      });
      return { width, height, variants };
    } catch (err) {
      this.logger.warn(`variant generation deferred for ${storageKey}: ${describeError(err)}`);
      return {};
    }
  }
}

function smallestVariant(variants: readonly AssetVariant[]): number | null {
  if (variants.length === 0) return null;
  return variants.reduce((min, v) => (v.width < min ? v.width : min), variants[0]!.width);
}

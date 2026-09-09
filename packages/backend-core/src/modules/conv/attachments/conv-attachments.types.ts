import type { AssetVariant } from '@getmunin/types';

export interface AttachmentDto {
  id: string;
  conversationId: string;
  messageId: string | null;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  inline: boolean;
  contentId: string | null;
  uploaded: boolean;
  thumbnailWidth: number | null;
  url: string | null;
  thumbnailUrl: string | null;
  deleted: boolean;
  createdAt: string;
}

export interface AttachmentUploadHandle extends AttachmentDto {
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadFields: Record<string, string>;
  uploadExpiresAt: string;
}

export interface MessageAttachmentProjection {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  thumbnailWidth: number | null;
  inline: boolean;
  cid: string | null;
  deleted: boolean;
}

export interface HydratedMessageAttachment extends MessageAttachmentProjection {
  url: string | null;
  thumbnailUrl: string | null;
}

export interface AttachmentVariants {
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
}

export interface MessageAttachmentGateway {
  attachToMessage(input: {
    messageId: string;
    conversationId: string;
    attachmentIds: readonly string[];
    sessionId?: string;
  }): Promise<AttachmentDto[]>;
  projectForMessage(rows: readonly AttachmentDto[]): MessageAttachmentProjection[];
  hydrateProjection(
    orgId: string,
    rows: readonly MessageAttachmentProjection[],
  ): HydratedMessageAttachment[];
  hydrateRaw(orgId: string, raw: unknown): HydratedMessageAttachment[];
}

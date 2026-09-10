'use client';

import { useCallback, useState } from 'react';
import {
  CONV_ATTACHMENT_MB_MAX,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
  attachmentRejectionFor,
  type AttachmentRejection,
} from '@getmunin/types';
import { api } from '../../api';
import { prepareImageForUpload, uploadToPresigned } from '../../lib/upload-image';

export interface PendingAttachment {
  key: string;
  name: string;
  previewUrl: string;
  attachmentId: string | null;
  status: 'uploading' | 'ready' | 'failed';
}

interface UploadHandle {
  id: string;
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadFields: Record<string, string>;
}

export interface AttachmentUploadMessages {
  rejected: (rejection: AttachmentRejection, ctx: { max: number; mb: number }) => string;
  failed: (name: string) => string;
}

export function useAttachmentUploads(
  conversationId: string | null,
  messages?: AttachmentUploadMessages,
  onError?: (message: string) => void,
) {
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  const reset = useCallback(() => {
    setPending((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
  }, []);

  const remove = useCallback((key: string) => {
    setPending((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!conversationId) return;
      const reject = (rejection: AttachmentRejection): void => {
        onError?.(
          messages?.rejected(rejection, {
            max: CONV_ATTACHMENT_PER_MESSAGE_MAX,
            mb: CONV_ATTACHMENT_MB_MAX,
          }) ?? rejection,
        );
      };

      let room = CONV_ATTACHMENT_PER_MESSAGE_MAX - pending.length;

      for (const file of files) {
        if (room <= 0) {
          reject('too_many');
          break;
        }
        const rejection = attachmentRejectionFor({ mime: file.type, sizeBytes: file.size });
        if (rejection) {
          reject(rejection);
          continue;
        }
        room -= 1;
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const previewUrl = URL.createObjectURL(file);
        setPending((prev) => [
          ...prev,
          { key, name: file.name, previewUrl, attachmentId: null, status: 'uploading' },
        ]);
        try {
          const prepared = await prepareImageForUpload(file);
          const handle = await api<UploadHandle>(
            `/v1/conversations/${conversationId}/attachments/upload-request`,
            {
              method: 'POST',
              body: JSON.stringify({
                name: prepared.name,
                mime: prepared.mime,
                sizeBytes: prepared.blob.size,
              }),
            },
          );
          await uploadToPresigned(handle, prepared);
          await api(
            `/v1/conversations/${conversationId}/attachments/${handle.id}/complete`,
            { method: 'POST' },
          );
          setPending((prev) =>
            prev.map((p) =>
              p.key === key ? { ...p, attachmentId: handle.id, status: 'ready' } : p,
            ),
          );
        } catch {
          setPending((prev) =>
            prev.map((p) => (p.key === key ? { ...p, status: 'failed' } : p)),
          );
          if (messages) onError?.(messages.failed(file.name));
        }
      }
    },
    [conversationId, messages, onError, pending.length],
  );

  const readyIds = pending
    .filter((p) => p.status === 'ready' && p.attachmentId)
    .map((p) => p.attachmentId!);
  const busy = pending.some((p) => p.status === 'uploading');

  return { pending, addFiles, remove, reset, readyIds, busy };
}

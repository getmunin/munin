'use client';

import { useCallback, useState } from 'react';
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

export function useAttachmentUploads(conversationId: string | null) {
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
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
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
        }
      }
    },
    [conversationId],
  );

  const readyIds = pending
    .filter((p) => p.status === 'ready' && p.attachmentId)
    .map((p) => p.attachmentId!);
  const busy = pending.some((p) => p.status === 'uploading');

  return { pending, addFiles, remove, reset, readyIds, busy };
}

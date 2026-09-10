import {
  CONV_ATTACHMENT_BYTES_MAX,
  CONV_ATTACHMENT_MIME_ALLOWLIST,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
  attachmentRejectionFor,
  type AttachmentRejection,
} from '@getmunin/types';

const MAX_EDGE_PX = 1600;
const SKIP_REENCODE_BELOW_BYTES = 128 * 1024;
const PASSTHROUGH_MIMES = new Set(['image/gif']);

export const ATTACHMENT_MIME_ALLOWLIST = CONV_ATTACHMENT_MIME_ALLOWLIST;

export const ATTACHMENT_BYTES_MAX = CONV_ATTACHMENT_BYTES_MAX;

export const ATTACHMENT_PER_MESSAGE_MAX = CONV_ATTACHMENT_PER_MESSAGE_MAX;

export type { AttachmentRejection };

export interface PreparedUpload {
  blob: Blob;
  name: string;
  mime: string;
}

export interface PresignedUploadTarget {
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadFields: Record<string, string>;
}

export function rejectionFor(file: File): AttachmentRejection | null {
  return attachmentRejectionFor({ mime: file.type, sizeBytes: file.size });
}

export function rejectionForPrepared(prepared: PreparedUpload): AttachmentRejection | null {
  return attachmentRejectionFor({ mime: prepared.mime, sizeBytes: prepared.blob.size });
}

export async function prepareImageForUpload(file: File): Promise<PreparedUpload> {
  const original: PreparedUpload = {
    blob: file,
    name: file.name || 'image',
    mime: normalizeMime(file.type) || 'application/octet-stream',
  };
  if (!file.type.startsWith('image/') || PASSTHROUGH_MIMES.has(normalizeMime(file.type))) {
    return original;
  }
  if (typeof createImageBitmap !== 'function') return original;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return original;
  }
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SKIP_REENCODE_BELOW_BYTES) return original;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob =
      (await encodeCanvas(canvas, 'image/webp', 0.82)) ??
      (await encodeCanvas(canvas, normalizeMime(file.type) === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.85));
    if (!blob) return original;
    if (scale === 1 && blob.size >= file.size) return original;
    return { blob, name: renameForMime(original.name, blob.type), mime: blob.type };
  } finally {
    bitmap.close();
  }
}

export async function uploadToPresigned(
  target: PresignedUploadTarget,
  prepared: PreparedUpload,
): Promise<void> {
  let res: Response;
  try {
    if (target.uploadMethod === 'POST') {
      const form = new FormData();
      for (const [key, value] of Object.entries(target.uploadFields)) {
        form.append(key, value);
      }
      form.append('file', prepared.blob, prepared.name);
      res = await fetch(target.uploadUrl, { method: 'POST', body: form });
    } else {
      res = await fetch(target.uploadUrl, {
        method: 'PUT',
        body: prepared.blob,
        headers: { 'Content-Type': prepared.mime },
      });
    }
  } catch {
    throw uploadFailedError('network error');
  }
  if (!res.ok) {
    throw uploadFailedError(`status ${res.status}`);
  }
}

function uploadFailedError(detail: string): Error {
  return Object.assign(new Error(`attachment upload failed: ${detail}`), {
    code: 'conv_attachment_upload_failed',
  });
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolveBlob) => {
    canvas.toBlob((b) => resolveBlob(b && b.type === mime ? b : null), mime, quality);
  });
}

function renameForMime(name: string, mime: string): string {
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png';
  const base = name.replace(/\.[^.]{1,16}$/, '');
  return `${base || 'image'}.${ext}`;
}

function normalizeMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

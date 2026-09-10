import type { MessageAttachmentProjection } from './conv-attachments.types.ts';

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parseMessageAttachmentProjection(
  raw: unknown,
): MessageAttachmentProjection[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageAttachmentProjection[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = optionalString(row.id);
    const mime = optionalString(row.mime);
    if (!id || !mime) continue;
    out.push({
      id,
      name: optionalString(row.name) ?? 'attachment',
      mime,
      sizeBytes: optionalNumber(row.sizeBytes) ?? 0,
      width: optionalNumber(row.width),
      height: optionalNumber(row.height),
      thumbnailWidth: optionalNumber(row.thumbnailWidth),
      inline: row.inline === true,
      cid: optionalString(row.cid),
      deleted: row.deleted === true,
    });
  }
  return out;
}

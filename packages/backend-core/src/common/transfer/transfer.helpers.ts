import { REDACTED, type IdMap, type ImportResult } from './transfer.types.ts';

export function newImportResult(): ImportResult {
  return { created: 0, updated: 0, skipped: 0, idMap: {}, warnings: [] };
}

export function resolveId(idMap: IdMap, sourceId: string | null | undefined): string | undefined {
  if (!sourceId) return undefined;
  return idMap[sourceId];
}

export function redactSecrets<T extends Record<string, unknown>>(
  row: T,
  fields: readonly (keyof T)[],
): T {
  const copy = { ...row };
  for (const f of fields) {
    if (copy[f] != null) (copy as Record<string, unknown>)[f as string] = REDACTED;
  }
  return copy;
}

export function isRedacted(value: unknown): boolean {
  return value === REDACTED;
}

export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
  return Buffer.from(`${iso}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep === -1) return null;
  return { createdAt: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

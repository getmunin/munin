import { z } from 'zod';

export const TRANSFER_VERSION = 1;

/**
 * Maps a source server's record id to the id it received on the target server.
 * Ids are globally-unique prefixed strings, so a single flat map across all
 * tables never collides. The agent accumulates this across module imports and
 * passes it back in so child records resolve their parents on the new server.
 */
export type IdMap = Record<string, string>;

/**
 * Sentinel written in place of a secret value on export. Secrets are
 * pgcrypto-encrypted with a server-specific key, so the ciphertext is useless
 * on another server — the operator re-enters them on the target.
 */
export const REDACTED = '__redacted__' as const;

export const IdMapSchema = z.record(z.string(), z.string());

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  idMap: IdMap;
  warnings: string[];
}

export interface ExportPage<T> {
  module: string;
  muninTransferVersion: number;
  records: T;
  nextCursor: string | null;
}

export const CursorInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type CursorInput = z.infer<typeof CursorInputSchema>;

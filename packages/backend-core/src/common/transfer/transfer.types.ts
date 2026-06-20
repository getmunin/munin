import { z } from 'zod';

export const TRANSFER_VERSION = 1;

export type IdMap = Record<string, string>;

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

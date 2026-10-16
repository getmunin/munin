import { z } from 'zod';

export const MAX_INGEST_FIELD_LENGTH = 8192;

export function truncatedString(max: number) {
  return z
    .string()
    .max(MAX_INGEST_FIELD_LENGTH)
    .transform((value) => value.slice(0, max));
}

export const MAX_INGEST_METADATA_BYTES = 4096;

export function ingestMetadata() {
  return z
    .record(z.string(), z.unknown())
    .transform((value) =>
      Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_INGEST_METADATA_BYTES ? value : null,
    );
}

export const ANALYTICS_VIEW_SOURCES = ['pixel', 'beacon', 'tracker'] as const;

export const analyticsViewSource = z.enum(ANALYTICS_VIEW_SOURCES);

export const analyticsReadDepth = z.number().int().min(0).max(100);

import { z } from 'zod';

export const MAX_INGEST_FIELD_LENGTH = 8192;

export function truncatedString(max: number) {
  return z
    .string()
    .max(MAX_INGEST_FIELD_LENGTH)
    .transform((value) => value.slice(0, max));
}

export const ANALYTICS_VIEW_SOURCES = ['pixel', 'beacon', 'tracker'] as const;

export const analyticsViewSource = z.enum(ANALYTICS_VIEW_SOURCES);

export const analyticsReadDepth = z.number().int().min(0).max(100);

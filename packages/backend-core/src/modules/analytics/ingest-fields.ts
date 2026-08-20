import { z } from 'zod';

export const MAX_INGEST_FIELD_LENGTH = 8192;

export function truncatedString(max: number) {
  return z
    .string()
    .max(MAX_INGEST_FIELD_LENGTH)
    .transform((value) => value.slice(0, max));
}

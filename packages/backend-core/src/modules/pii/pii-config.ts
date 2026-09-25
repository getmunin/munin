import { parseEnvBool } from '@getmunin/core';

export const PII_WORKER_SECRET_MIN_LENGTH = 24;

export function isPiiNerEnabled(): boolean {
  return parseEnvBool({ name: 'MUNIN_PII_NER_ENABLED', default: false });
}

export function readPiiWorkerSecrets(): string[] {
  const raw = process.env.MUNIN_PII_WORKER_SECRET ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= PII_WORKER_SECRET_MIN_LENGTH);
}

export function readPseudonymSecret(): string {
  return process.env.MUNIN_KEY_PEPPER ?? '';
}

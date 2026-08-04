import { asRecord } from './json-shape.ts';

export const CHANNEL_SECRET_MASK = '••••';

const ENCRYPTED_PREFIX = 'encrypted';

const PRESENCE_ONLY_KEYS: Record<string, string> = {
  identityVerificationSecret: 'hasIdentityVerificationSecret',
};

export function publicChannelConfig(config: unknown): Record<string, unknown> {
  return asRecord(project(asRecord(config)));
}

function project(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(project);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const presenceKey = PRESENCE_ONLY_KEYS[key];
    if (presenceKey) {
      out[presenceKey] = isPresent(raw);
      continue;
    }
    if (key.length > ENCRYPTED_PREFIX.length && key.startsWith(ENCRYPTED_PREFIX)) {
      out[plaintextKey(key)] = isPresent(raw) ? CHANNEL_SECRET_MASK : '';
      continue;
    }
    out[key] = project(raw);
  }
  return out;
}

function isPresent(raw: unknown): boolean {
  return typeof raw === 'string' && raw.length > 0;
}

function plaintextKey(encryptedKey: string): string {
  const rest = encryptedKey.slice(ENCRYPTED_PREFIX.length);
  return rest[0]!.toLowerCase() + rest.slice(1);
}

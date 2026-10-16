const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^replace[-_]?me/i,
  /^dev[-_]?secret/i,
  /^test[-_]?secret/i,
  /^changeme/i,
  /do[-_]?not[-_]?use/i,
  /^(?:[a-z]+|x+|0+)$/i,
];

export const MIN_PRODUCTION_KEY_LENGTH = 16;

const ROTATION_WARNING: Record<string, string> = {
  MUNIN_KEY_PEPPER:
    'Changing it invalidates every existing API key, widget key and signed link, so on a deployment that already has data, set the value it has been running with.',
  MUNIN_ENCRYPTION_KEY:
    'Changing it makes every stored channel, connector and LLM secret unreadable, so on a deployment that already has data, set the value it has been running with.',
};

export function isPlaceholderSecret(secret: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(secret));
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function assertProductionSecret(name: string, value: string | undefined, minLength: number): void {
  if (!isProduction()) return;
  const generate = 'Generate one with `openssl rand -base64 48`.';
  const warning = ROTATION_WARNING[name];
  const suffix = warning ? `${generate} ${warning}` : generate;
  if (!value) {
    throw new Error(`${name} is required in production. ${suffix}`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters in production. ${suffix}`);
  }
  if (isPlaceholderSecret(value)) {
    throw new Error(`${name} looks like a placeholder/dev value. ${suffix}`);
  }
}

export function assertProductionKeySecrets(): void {
  assertProductionSecret('MUNIN_KEY_PEPPER', process.env.MUNIN_KEY_PEPPER, MIN_PRODUCTION_KEY_LENGTH);
  assertProductionSecret(
    'MUNIN_ENCRYPTION_KEY',
    process.env.MUNIN_ENCRYPTION_KEY,
    MIN_PRODUCTION_KEY_LENGTH,
  );
}

export function readKeyPepper(): string {
  const pepper = process.env.MUNIN_KEY_PEPPER ?? '';
  if (!pepper && isProduction()) {
    throw new Error('MUNIN_KEY_PEPPER is required in production to hash API keys and tokens');
  }
  return pepper;
}

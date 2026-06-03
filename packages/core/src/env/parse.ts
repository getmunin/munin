export type ParseEnvIntOptions = {
  name: string;
  default?: number;
  min?: number;
  max?: number;
  onInvalid?: 'throw' | 'fallback';
};

export function parseEnvInt(opts: ParseEnvIntOptions): number {
  const onInvalid = opts.onInvalid ?? (opts.default !== undefined ? 'fallback' : 'throw');
  const raw = process.env[opts.name];

  if (raw === undefined || raw === '') {
    if (opts.default !== undefined) return opts.default;
    throw new Error(`${opts.name} is required`);
  }

  const parsed = Number.parseInt(raw, 10);
  const inRange =
    Number.isInteger(parsed) &&
    (opts.min === undefined || parsed >= opts.min) &&
    (opts.max === undefined || parsed <= opts.max);

  if (inRange) return parsed;

  if (onInvalid === 'fallback' && opts.default !== undefined) return opts.default;

  const rangeHint =
    opts.min !== undefined || opts.max !== undefined
      ? ` in ${opts.min ?? '-∞'}..${opts.max ?? '∞'}`
      : '';
  throw new Error(`${opts.name} must be an integer${rangeHint}, got ${raw}`);
}

export type ParseEnvBoolOptions = {
  name: string;
  default: boolean;
};

export function parseEnvBool(opts: ParseEnvBoolOptions): boolean {
  const raw = process.env[opts.name];
  if (raw === undefined) return opts.default;
  const lower = raw.trim().toLowerCase();
  if (lower === '1' || lower === 'true') return true;
  if (lower === '0' || lower === 'false') return false;
  return opts.default;
}

export function parseEnvDisableFlag(name: string): boolean {
  return parseEnvBool({ name, default: false });
}

export type ParseEnvCronOptions = {
  name: string;
  default: string;
};

export function parseEnvCron(opts: ParseEnvCronOptions): string | null {
  const raw = process.env[opts.name]?.trim();
  const value = raw && raw.length > 0 ? raw : opts.default;
  if (value === 'off' || value === '0') return null;
  return value;
}

export type ParseEnvIntOptions = {
  min?: number;
  max?: number;
};

export function parseEnvInt(name: string, options: ParseEnvIntOptions = {}): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  const inRange =
    Number.isInteger(n) &&
    (options.min === undefined || n >= options.min) &&
    (options.max === undefined || n <= options.max);
  if (inRange) return n;
  const range =
    options.min !== undefined || options.max !== undefined
      ? ` in ${options.min ?? '-∞'}..${options.max ?? '∞'}`
      : '';
  throw new Error(`${name} must be an integer${range}, got "${raw}"`);
}

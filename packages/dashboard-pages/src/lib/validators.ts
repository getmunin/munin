/**
 * Lightweight client-side validators for use inside dialog forms.
 * Each returns `true` when the input is acceptable, `false` otherwise.
 * They are intentionally permissive — the backend's Zod schemas are the
 * source of truth; these just filter out clearly-malformed input so we
 * don't waste a network round-trip on it.
 */

const HOST_RE =
  /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidHost(value: string): boolean {
  return HOST_RE.test(value);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function isValidPort(value: string | number): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

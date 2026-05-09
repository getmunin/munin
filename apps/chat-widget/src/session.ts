/**
 * Per-channel sessionId management.
 *
 * The widget identifies a visitor's conversation by `sessionId` — a random
 * UUID kept in `localStorage`, namespaced by `channelId` so multiple widget
 * channels on the same domain don't collide. Refreshes resume the same
 * conversation; clearing storage starts a new one.
 *
 * `localStorage` may be unavailable (private mode, sandboxed iframes,
 * disabled per-origin) — we fall back to an ephemeral in-memory session
 * for the page lifetime so the widget still works, just without
 * cross-page persistence.
 */

const STORAGE_PREFIX = 'munin-widget-session:';

let ephemeralFallback: Map<string, string> | null = null;

export function getSessionId(channelId: string): string {
  const key = STORAGE_PREFIX + channelId;
  const stored = readStorage(key);
  if (stored && stored.length > 0) return stored;
  const fresh = randomId();
  writeStorage(key, fresh);
  return fresh;
}

export function clearSessionId(channelId: string): void {
  const key = STORAGE_PREFIX + channelId;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  ephemeralFallback?.delete(key);
}

function readStorage(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw && raw.length > 0) return raw;
  } catch {
    // localStorage unavailable
  }
  return ephemeralFallback?.get(key) ?? null;
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch {
    // fall through
  }
  if (!ephemeralFallback) ephemeralFallback = new Map();
  ephemeralFallback.set(key, value);
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for browsers without `crypto.randomUUID` (pre-2022 Safari).
  // Not crypto-grade but adequate for a sessionId — the widget key + origin
  // allowlist + (optional) HMAC carry the actual security.
  const a = Math.random().toString(36).slice(2);
  const b = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${a}${b}`.slice(0, 64);
}

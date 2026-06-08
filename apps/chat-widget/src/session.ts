const STORAGE_PREFIX = 'munin-widget-session:';
const COOKIE_PREFIX = 'munin-widget-session-';
const VISITOR_STORAGE_PREFIX = 'munin-widget-visitor:';
const VISITOR_COOKIE_PREFIX = 'munin-widget-visitor-';
const SHARED_VISITOR_KEY = 'mn.vid';
const RECENT_CAP = 20;
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

interface SessionState {
  current: string;
  recent: string[];
}

const memory = new Map<string, SessionState>();

export function getSessionId(channelId: string): string {
  return loadState(channelId).current;
}

export function getRecentSessionIds(channelId: string): string[] {
  const state = loadState(channelId);
  return [state.current, ...state.recent];
}

export function mintNewSession(channelId: string): string {
  const state = loadState(channelId);
  const fresh = randomId();
  const recent = [state.current, ...state.recent].filter((s) => s !== fresh).slice(0, RECENT_CAP);
  const next: SessionState = { current: fresh, recent };
  saveState(channelId, next);
  return fresh;
}

export function setCurrentSession(channelId: string, sessionId: string): void {
  const state = loadState(channelId);
  if (state.current === sessionId) return;
  const recent = [state.current, ...state.recent].filter((s) => s !== sessionId).slice(0, RECENT_CAP);
  saveState(channelId, { current: sessionId, recent });
}

export function clearSessionId(channelId: string): void {
  memory.delete(channelId);
  try {
    localStorage.removeItem(STORAGE_PREFIX + channelId);
  } catch (err) {
    console.warn('[munin-widget] clearSessionId localStorage:', err);
  }
  writeCookie(channelId, '', 0);
}

const visitorMemory = new Map<string, string>();

export function getVisitorId(channelId: string): string {
  const cached = visitorMemory.get(channelId);
  if (cached) return cached;
  const stored =
    readStorage(VISITOR_STORAGE_PREFIX + channelId) ??
    readCookie(VISITOR_COOKIE_PREFIX + channelId) ??
    readStorage(SHARED_VISITOR_KEY);
  if (stored && stored.length > 0) {
    visitorMemory.set(channelId, stored);
    writeStorage(VISITOR_STORAGE_PREFIX + channelId, stored);
    writeStorage(SHARED_VISITOR_KEY, stored);
    return stored;
  }
  const fresh = randomId();
  visitorMemory.set(channelId, fresh);
  writeStorage(VISITOR_STORAGE_PREFIX + channelId, fresh);
  writeStorage(SHARED_VISITOR_KEY, fresh);
  writeVisitorCookie(channelId, fresh, COOKIE_MAX_AGE_S);
  return fresh;
}

function writeVisitorCookie(channelId: string, value: string, maxAgeS: number): void {
  try {
    const secure = typeof location !== 'undefined' && location.protocol === 'https:';
    const parts = [
      `${VISITOR_COOKIE_PREFIX + channelId}=${encodeURIComponent(value)}`,
      'Path=/',
      'SameSite=Lax',
    ];
    if (secure) parts.push('Secure');
    if (maxAgeS <= 0) parts.push('Max-Age=0');
    else parts.push(`Max-Age=${maxAgeS}`);
    document.cookie = parts.join('; ');
  } catch (err) {
    console.warn('[munin-widget] visitor cookie write:', err);
  }
}

function loadState(channelId: string): SessionState {
  const cached = memory.get(channelId);
  if (cached) return cached;

  const raw = readStorage(STORAGE_PREFIX + channelId) ?? readCookie(COOKIE_PREFIX + channelId);
  const parsed = parseState(raw);
  if (parsed) {
    memory.set(channelId, parsed);
    return parsed;
  }

  const fresh: SessionState = { current: randomId(), recent: [] };
  saveState(channelId, fresh);
  return fresh;
}

function saveState(channelId: string, state: SessionState): void {
  memory.set(channelId, state);
  const serialized = JSON.stringify(state);
  writeStorage(STORAGE_PREFIX + channelId, serialized);
  writeCookie(channelId, serialized, COOKIE_MAX_AGE_S);
}

function parseState(raw: string | null): SessionState | null {
  if (!raw) return null;
  if (raw[0] !== '{') {
    if (raw.length === 0) return null;
    return { current: raw, recent: [] };
  }
  try {
    const obj = JSON.parse(raw) as Partial<SessionState>;
    if (typeof obj.current !== 'string' || obj.current.length === 0) return null;
    const recent = Array.isArray(obj.recent)
      ? obj.recent.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, RECENT_CAP)
      : [];
    return { current: obj.current, recent };
  } catch (err) {
    console.warn('[munin-widget] session parse:', err);
    return null;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn('[munin-widget] localStorage read:', err);
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn('[munin-widget] localStorage write:', err);
  }
}

function readCookie(name: string): string | null {
  try {
    const all = document.cookie;
    if (!all) return null;
    const prefix = name + '=';
    for (const part of all.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        try {
          return decodeURIComponent(trimmed.slice(prefix.length));
        } catch (err) {
          console.warn('[munin-widget] cookie decode:', err);
          return trimmed.slice(prefix.length);
        }
      }
    }
    return null;
  } catch (err) {
    console.warn('[munin-widget] cookie read:', err);
    return null;
  }
}

function writeCookie(channelId: string, value: string, maxAgeS: number): void {
  try {
    const secure = typeof location !== 'undefined' && location.protocol === 'https:';
    const parts = [
      `${COOKIE_PREFIX + channelId}=${encodeURIComponent(value)}`,
      'Path=/',
      'SameSite=Lax',
    ];
    if (secure) parts.push('Secure');
    if (maxAgeS <= 0) parts.push('Max-Age=0');
    else parts.push(`Max-Age=${maxAgeS}`);
    document.cookie = parts.join('; ');
  } catch (err) {
    console.warn('[munin-widget] cookie write:', err);
  }
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      out += bytes[i]!.toString(16).padStart(2, '0');
    }
    return out;
  }
  throw new Error('[munin-widget] crypto API unavailable');
}

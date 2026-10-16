import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  adoptSessionOwner,
  clearSessionId,
  getRecentSessionIds,
  getSessionId,
  getSessionOwner,
  getVisitorId,
  mintNewSession,
  setCurrentSession,
} from './session.ts';

function captureCookieWrites(fn: () => void): string[] {
  const writes: string[] = [];
  const original = Object.getOwnPropertyDescriptor(document, 'cookie');
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: (v: string) => {
      writes.push(v);
    },
  });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(document, 'cookie', original);
    else delete (document as unknown as { cookie?: string }).cookie;
  }
  return writes;
}

const CHANNEL = 'cnv_test';

function freshChannel(): string {
  return `cnv_${Math.random().toString(36).slice(2)}`;
}

describe('session', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {}
    document.cookie.split(';').forEach((c) => {
      const eq = c.indexOf('=');
      const name = (eq > -1 ? c.slice(0, eq) : c).trim();
      if (name.startsWith('munin-widget-session-')) {
        document.cookie = `${name}=; Max-Age=0; Path=/`;
      }
    });
  });

  afterEach(() => {
    clearSessionId(CHANNEL);
  });

  it('mints a fresh sessionId the first time and persists it', () => {
    const ch = freshChannel();
    const a = getSessionId(ch);
    const b = getSessionId(ch);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it('rotates current → recent on mintNewSession and caps history', () => {
    const ch = freshChannel();
    const first = getSessionId(ch);
    const second = mintNewSession(ch);
    expect(second).not.toBe(first);
    expect(getSessionId(ch)).toBe(second);
    expect(getRecentSessionIds(ch)).toContain(first);
    expect(getRecentSessionIds(ch)[0]).toBe(second);
  });

  it('setCurrentSession promotes a known sessionId without minting a new one', () => {
    const ch = freshChannel();
    const first = getSessionId(ch);
    const second = mintNewSession(ch);
    setCurrentSession(ch, first);
    expect(getSessionId(ch)).toBe(first);
    expect(getRecentSessionIds(ch)).toContain(second);
  });

  it('appends Domain to the session + visitor cookies when cookieDomain is set', () => {
    const ch = freshChannel();
    const writes = captureCookieWrites(() => {
      getSessionId(ch, '.example.com');
      getVisitorId(ch, '.example.com');
    });
    expect(
      writes.some(
        (w) => w.startsWith(`munin-widget-session-${ch}=`) && w.includes('Domain=.example.com'),
      ),
    ).toBe(true);
    expect(
      writes.some(
        (w) => w.startsWith(`munin-widget-visitor-${ch}=`) && w.includes('Domain=.example.com'),
      ),
    ).toBe(true);
  });

  it('writes host-only cookies (no Domain) when cookieDomain is omitted', () => {
    const ch = freshChannel();
    const writes = captureCookieWrites(() => {
      getSessionId(ch);
      getVisitorId(ch);
    });
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => !w.includes('Domain='))).toBe(true);
  });

  it('survives localStorage throwing (cookie fallback)', () => {
    const ch = freshChannel();
    const proto = Storage.prototype as Storage & { setItem: Storage['setItem'] };
    const original: Storage['setItem'] = proto.setItem.bind(proto);
    proto.setItem = () => {
      throw new Error('blocked');
    };
    try {
      const a = getSessionId(ch);
      expect(a.length).toBeGreaterThan(8);
      expect(document.cookie).toContain(`munin-widget-session-${ch}`);
    } finally {
      proto.setItem = original;
    }
  });

  it('keeps the session when an anonymous visitor signs in, so the claim carries their chat over', () => {
    const ch = freshChannel();
    const anon = getSessionId(ch);
    expect(adoptSessionOwner(ch, null)).toBe(false);
    expect(adoptSessionOwner(ch, 'user-a')).toBe(false);
    expect(getSessionId(ch)).toBe(anon);
    expect(getSessionOwner(ch)).toBe('user-a');
  });

  it('starts a fresh session with no history when the signed-in user signs out', () => {
    const ch = freshChannel();
    adoptSessionOwner(ch, 'user-a');
    const first = getSessionId(ch);
    mintNewSession(ch);
    expect(adoptSessionOwner(ch, null)).toBe(true);
    expect(getSessionId(ch)).not.toBe(first);
    expect(getRecentSessionIds(ch)).toEqual([getSessionId(ch)]);
    expect(getSessionOwner(ch)).toBeNull();
  });

  it('starts a fresh session when a different user signs in on the same browser', () => {
    const ch = freshChannel();
    adoptSessionOwner(ch, 'user-a');
    const first = getSessionId(ch);
    expect(adoptSessionOwner(ch, 'user-b')).toBe(true);
    expect(getRecentSessionIds(ch)).not.toContain(first);
    expect(getSessionOwner(ch)).toBe('user-b');
  });

  it('keeps the owner across new chats and persists it to storage', () => {
    const ch = freshChannel();
    adoptSessionOwner(ch, 'user-a');
    mintNewSession(ch);
    setCurrentSession(ch, getRecentSessionIds(ch)[1]!);
    expect(getSessionOwner(ch)).toBe('user-a');
    const stored = JSON.parse(localStorage.getItem(`munin-widget-session:${ch}`)!) as {
      owner?: string;
    };
    expect(stored.owner).toBe('user-a');
  });
});

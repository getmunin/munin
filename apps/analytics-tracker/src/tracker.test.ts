import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const VISITOR_KEY = 'mn.vid';

const nativePushState = history.pushState.bind(history);
const nativeReplaceState = history.replaceState.bind(history);

interface BeaconCall {
  url: string;
  blob: Blob;
}

let beacons: BeaconCall[];
let sendBeacon: ReturnType<typeof vi.fn>;
let keyCounter = 0;

interface LoadOpts {
  /** Attributes set on the injected <script> tag. `null` values are skipped. */
  attrs?: Record<string, string | null>;
  /** `script.src`, used for the data-api origin fallback. */
  src?: string;
  /** Omit the auto-generated data-key (for the "disabled" paths). */
  noKey?: boolean;
  /** Don't define document.currentScript (simulate inline/unknown script). */
  noCurrentScript?: boolean;
}

/**
 * Re-runs the tracker IIFE against freshly staged globals and returns the
 * unique data-key bound to this load, so callers can filter beacons emitted
 * by listeners that earlier loads left attached to the shared window.
 */
async function loadTracker(opts: LoadOpts = {}): Promise<string> {
  const key = opts.noKey ? '' : `mn_track_${++keyCounter}`;
  const script = document.createElement('script');
  script.src = opts.src ?? 'https://cdn.example.com/tracker.abc123.js';
  if (!opts.noKey) script.setAttribute('data-key', key);
  for (const [name, value] of Object.entries(opts.attrs ?? {})) {
    if (value !== null) script.setAttribute(name, value);
  }
  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get: () => (opts.noCurrentScript ? null : script),
  });

  vi.resetModules();
  await import('./tracker.ts');
  return key;
}

async function decode(call: BeaconCall): Promise<Record<string, unknown>> {
  return JSON.parse(await call.blob.text()) as Record<string, unknown>;
}

/** Beacons sent to a given path, filtered to the load that owns `key`. */
async function beaconsFor(key: string, pathSuffix: string): Promise<Record<string, unknown>[]> {
  const matches = beacons.filter((b) => b.url.endsWith(pathSuffix));
  const decoded = await Promise.all(matches.map(decode));
  return decoded.filter((p) => p.key === key);
}

interface MnApi {
  track: (id: string, attrs?: Record<string, unknown>) => void;
  trackPageView: () => void;
  getVisitorId: () => string;
  identify: (externalId: string, userHash: string) => void;
}

function mn(): MnApi {
  return (window as unknown as { mn: MnApi }).mn;
}

function setLocation(href: string): void {
  window.location.href = href;
}

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', { configurable: true, value });
}

beforeEach(() => {
  beacons = [];
  sendBeacon = vi.fn((url: string, blob: Blob) => {
    beacons.push({ url, blob });
    return true;
  });
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  delete (window as { mn?: unknown }).mn;
  setLocation('https://site.example/welcome');
  setReferrer('');
  document.documentElement.lang = '';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  history.pushState = nativePushState;
  history.replaceState = nativeReplaceState;
  vi.restoreAllMocks();
});

describe('initialization guards', () => {
  it('disables itself and warns when data-key is missing', async () => {
    await loadTracker({ noKey: true });
    expect(beacons).toHaveLength(0);
    expect((window as { mn?: unknown }).mn).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('data-key attribute missing'));
  });

  it('disables itself when document.currentScript is unavailable', async () => {
    await loadTracker({ noCurrentScript: true });
    expect(beacons).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('currentScript unavailable'));
  });
});

describe('endpoint resolution', () => {
  it('beacons to <data-api>/v1/a/t with the trailing slash stripped', async () => {
    const key = await loadTracker({ attrs: { 'data-api': 'https://api.example.com///' } });
    const sent = beacons.filter((b) => b.url.endsWith('/v1/a/t'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.example.com/v1/a/t');
    const [payload] = await beaconsFor(key, '/v1/a/t');
    expect(payload!.key).toBe(key);
  });

  it('falls back to the script.src origin when data-api is absent', async () => {
    await loadTracker({ src: 'https://cdn.example.com/sub/tracker.js' });
    const sent = beacons.filter((b) => b.url.endsWith('/v1/a/t'));
    expect(sent[0]!.url).toBe('https://cdn.example.com/v1/a/t');
  });
});

describe('automatic page view', () => {
  it('fires once on load with sensible defaults', async () => {
    setLocation('https://site.example/pricing?ref=nav');
    setReferrer('https://google.com/');
    document.documentElement.lang = 'en-US';
    const key = await loadTracker();

    const views = await beaconsFor(key, '/v1/a/t');
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      key,
      subjectType: 'page',
      subjectId: '/pricing',
      path: '/pricing?ref=nav',
      referrer: 'https://google.com/',
      locale: 'en-US',
    });
    expect(typeof views[0]!.visitorId).toBe('string');
  });

  it('honors a data-subject-type override', async () => {
    const key = await loadTracker({ attrs: { 'data-subject-type': 'cms_entry' } });
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(view!.subjectType).toBe('cms_entry');
  });

  it('parses utm params from the query string', async () => {
    setLocation('https://site.example/lp?utm_source=newsletter&utm_medium=email&utm_campaign=spring');
    const key = await loadTracker();
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(view!.utm).toEqual({ source: 'newsletter', medium: 'email', campaign: 'spring' });
  });

  it('defers the page view until DOMContentLoaded while document is loading', async () => {
    const readySpy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const key = await loadTracker();
    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(0);

    readySpy.mockReturnValue('complete');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(1);
  });
});

describe('visitor id persistence', () => {
  it('mints a visitor id, persists it, and reuses it across reloads', async () => {
    const key1 = await loadTracker();
    const [first] = await beaconsFor(key1, '/v1/a/t');
    const visitorId = first!.visitorId as string;
    expect(localStorage.getItem(VISITOR_KEY)).toBe(visitorId);

    const key2 = await loadTracker();
    const [second] = await beaconsFor(key2, '/v1/a/t');
    expect(second!.visitorId).toBe(visitorId);
  });

  it('falls back to an in-memory id when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const key = await loadTracker();
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(typeof view!.visitorId).toBe('string');
    expect((view!.visitorId as string).length).toBeGreaterThan(8);
  });
});

describe('window.mn.track', () => {
  it('sends a custom event with attribute overrides', async () => {
    const key = await loadTracker();
    beacons = [];
    mn().track('doc_42', {
      subjectType: 'kb_document',
      path: '/kb/doc_42',
      referrer: null,
      readDepth: 80,
      metadata: { foo: 'bar' },
    });
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(view).toMatchObject({
      subjectId: 'doc_42',
      subjectType: 'kb_document',
      path: '/kb/doc_42',
      referrer: null,
      readDepth: 80,
      metadata: { foo: 'bar' },
    });
  });
});

describe('identify', () => {
  it('sends externalId, userHash and the caller visitor id', async () => {
    const key = await loadTracker();
    beacons = [];
    const visitorId = mn().getVisitorId();
    mn().identify('user_7', 'abc123');
    const [payload] = await beaconsFor(key, '/v1/a/identify');
    expect(payload).toMatchObject({ key, externalId: 'user_7', userHash: 'abc123', visitorId });
  });

  it('exposes the visitor id used by page-view beacons', async () => {
    const key = await loadTracker();
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(mn().getVisitorId()).toBe(view!.visitorId);
  });

  it('warns and sends nothing when identify is called without both args', async () => {
    const key = await loadTracker();
    beacons = [];
    mn().identify('user_7', '');
    expect(await beaconsFor(key, '/v1/a/identify')).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('identify requires'));
  });

  it('forwards to a pre-existing window.mn.identify', async () => {
    const prior = vi.fn();
    (window as { mn?: { identify?: unknown } }).mn = { identify: prior };
    const key = await loadTracker();
    mn().identify('user_9', 'hash9');
    expect(prior).toHaveBeenCalledWith('user_9', 'hash9');
    expect(await beaconsFor(key, '/v1/a/identify')).toHaveLength(1);
  });
});

describe('SPA mode', () => {
  it('fires a view on pushState route changes with dwell time and no referrer', async () => {
    const key = await loadTracker({ attrs: { 'data-spa': 'true' } });
    beacons = [];
    history.pushState({}, '', '/account/settings');

    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(view).toMatchObject({ subjectId: '/account/settings', referrer: null });
    expect(typeof view!.dwellMs).toBe('number');
  });

  it('ignores route changes that do not change the pathname', async () => {
    const key = await loadTracker({ attrs: { 'data-spa': 'true' } });
    beacons = [];
    history.pushState({}, '', '/welcome?tab=2');
    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(0);
  });

  it('does not track route changes when SPA mode is off', async () => {
    const key = await loadTracker();
    beacons = [];
    history.pushState({}, '', '/somewhere-else');
    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(0);
  });
});

describe('pagehide', () => {
  it('reports a final view with dwell time on pagehide', async () => {
    const key = await loadTracker();
    beacons = [];
    window.dispatchEvent(new Event('pagehide'));
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(view).toMatchObject({ referrer: null });
    expect(typeof view!.dwellMs).toBe('number');
  });
});

describe('transport fallback', () => {
  it('uses fetch with keepalive when sendBeacon is unavailable', async () => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined });
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await loadTracker();
      expect(fetchMock).toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0]!;
      expect(init).toMatchObject({
        method: 'POST',
        keepalive: true,
        mode: 'no-cors',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

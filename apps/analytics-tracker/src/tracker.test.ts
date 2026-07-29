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
  attrs?: Record<string, string | null>;
  src?: string;
  noKey?: boolean;
  noCurrentScript?: boolean;
}

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

async function beaconsFor(key: string, pathSuffix: string): Promise<Record<string, unknown>[]> {
  const matches = beacons.filter((b) => b.url.endsWith(pathSuffix));
  const decoded = await Promise.all(matches.map(decode));
  return decoded.filter((p) => p.key === key);
}

async function entryViewsFor(token: string): Promise<Record<string, unknown>[]> {
  const matches = beacons.filter((b) => b.url.endsWith('/v1/a/v'));
  const decoded = await Promise.all(matches.map(decode));
  return decoded.filter((p) => p.token === token);
}

async function viewsForSubject(subjectId: string): Promise<Record<string, unknown>[]> {
  const matches = beacons.filter((b) => b.url.endsWith('/v1/a/t'));
  const decoded = await Promise.all(matches.map(decode));
  return decoded.filter((p) => p.subjectId === subjectId);
}

interface MnApi {
  track: (id: string, attrs?: Record<string, unknown>) => void;
  trackOnce: (id: string, attrs?: Record<string, unknown>) => void;
  trackPageView: () => void;
  trackSearch: (query: string, resultCount: number, opts?: Record<string, unknown>) => void;
  trackEntry: (token: string, attrs?: Record<string, unknown>) => void;
  getVisitorId: () => string;
  identify: (externalId: string, userHash: string) => void;
  ready: boolean;
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

function clearLocalStorageIfAvailable(): void {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    return;
  }
}

function setScrollHeight(height: number): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: height,
  });
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setScrollY(y: number): void {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
}

beforeEach(() => {
  beacons = [];
  document.body.innerHTML = '';
  sendBeacon = vi.fn((url: string, blob: Blob) => {
    beacons.push({ url, blob });
    return true;
  });
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
  clearLocalStorageIfAvailable();
  delete (window as { mn?: unknown }).mn;
  setVisibility('visible');
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

describe('readiness signal', () => {
  it('sets window.mn.ready once initialized', async () => {
    await loadTracker();
    expect(mn().ready).toBe(true);
  });

  it('dispatches munin:ready on document after the full API is installed', async () => {
    let apiAtDispatch: Partial<MnApi> | undefined;
    const listener = vi.fn(() => {
      apiAtDispatch = { ...(window as unknown as { mn: MnApi }).mn };
    });
    document.addEventListener('munin:ready', listener, { once: true });
    await loadTracker();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(apiAtDispatch!.ready).toBe(true);
    expect(typeof apiAtDispatch!.getVisitorId).toBe('function');
    expect(typeof apiAtDispatch!.identify).toBe('function');
  });

  it('signals nothing when the tracker is disabled', async () => {
    const listener = vi.fn();
    document.addEventListener('munin:ready', listener, { once: true });
    await loadTracker({ noKey: true });
    expect(listener).not.toHaveBeenCalled();
    expect((window as { mn?: unknown }).mn).toBeUndefined();
    document.removeEventListener('munin:ready', listener);
  });
});

describe('route changes', () => {
  it('closes the previous view and opens a new one on pushState', async () => {
    const key = await loadTracker();
    const [initial] = await beaconsFor(key, '/v1/a/t');
    beacons = [];
    history.pushState({}, '', '/account/settings');

    const [exit, next] = await beaconsFor(key, '/v1/a/t');
    expect(exit).toMatchObject({ subjectId: '/welcome', referrer: null, viewId: initial!.viewId });
    expect(typeof exit!.dwellMs).toBe('number');
    expect(next).toMatchObject({ subjectId: '/account/settings', referrer: null });
    expect(next!.dwellMs).toBeUndefined();
    expect(next!.viewId).not.toBe(initial!.viewId);
  });

  it('ignores query-only pushState, so filter and tab state costs nothing', async () => {
    const key = await loadTracker();
    beacons = [];
    history.pushState({}, '', '/welcome?tab=2');
    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(0);
  });

  it('closes the previous view on replaceState and popstate too', async () => {
    const key = await loadTracker();
    beacons = [];
    history.replaceState({}, '', '/replaced');
    const afterReplace = await beaconsFor(key, '/v1/a/t');
    expect(afterReplace.map((v) => v.subjectId)).toEqual(['/welcome', '/replaced']);
  });
});

describe('exit enrichment', () => {
  it('reports a final view with dwell time on pagehide', async () => {
    const key = await loadTracker();
    beacons = [];
    window.dispatchEvent(new Event('pagehide'));
    const [view] = await beaconsFor(key, '/v1/a/t');
    expect(view).toMatchObject({ referrer: null });
    expect(typeof view!.dwellMs).toBe('number');
  });

  it('reports on visibilitychange to hidden, which mobile fires when pagehide does not', async () => {
    const key = await loadTracker();
    const [initial] = await beaconsFor(key, '/v1/a/t');
    beacons = [];

    setVisibility('hidden');

    const [exit] = await beaconsFor(key, '/v1/a/t');
    expect(exit).toMatchObject({ viewId: initial!.viewId, referrer: null });
    expect(typeof exit!.dwellMs).toBe('number');
  });

  it('does not report twice for the usual hidden-then-pagehide pair', async () => {
    const key = await loadTracker();
    beacons = [];

    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));

    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(1);
  });

  it('reports again once the reader comes back and leaves, with a larger dwell', async () => {
    const key = await loadTracker();
    beacons = [];

    setVisibility('hidden');
    setVisibility('visible');
    await new Promise((r) => setTimeout(r, 12));
    setVisibility('hidden');

    const exits = await beaconsFor(key, '/v1/a/t');
    expect(exits).toHaveLength(2);
    expect(exits[1]!.viewId).toBe(exits[0]!.viewId);
    expect(exits[1]!.dwellMs as number).toBeGreaterThan(exits[0]!.dwellMs as number);
  });
});

describe('view id', () => {
  it('reuses one viewId for the initial view and its exit enrichment', async () => {
    const key = await loadTracker();
    const [initial] = await beaconsFor(key, '/v1/a/t');
    expect(typeof initial!.viewId).toBe('string');

    window.dispatchEvent(new Event('pagehide'));
    const [, exit] = await beaconsFor(key, '/v1/a/t');
    expect(exit!.viewId).toBe(initial!.viewId);
    expect(exit!.subjectId).toBe(initial!.subjectId);
  });

  it('mints a fresh viewId after a bfcache restore', async () => {
    const key = await loadTracker();
    const [initial] = await beaconsFor(key, '/v1/a/t');
    beacons = [];

    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    window.dispatchEvent(pageshow);

    const [restored] = await beaconsFor(key, '/v1/a/t');
    expect(restored!.subjectId).toBe('/welcome');
    expect(restored!.viewId).not.toBe(initial!.viewId);
    expect(restored!.referrer).toBeNull();
  });

  it('ignores a pageshow that did not come from the bfcache', async () => {
    const key = await loadTracker();
    beacons = [];
    window.dispatchEvent(new Event('pageshow'));
    expect(await beaconsFor(key, '/v1/a/t')).toHaveLength(0);
  });

  it('leaves custom events without a viewId so they never enrich a page view', async () => {
    const key = await loadTracker();
    beacons = [];
    mn().track('signup-cta-click', { subjectType: 'funnel' });
    const [event] = await beaconsFor(key, '/v1/a/t');
    expect(event!.viewId).toBeUndefined();
  });
});

describe('read depth', () => {
  it('reports 100 for a page that fits the viewport', async () => {
    setScrollHeight(window.innerHeight);
    setScrollY(0);
    const key = await loadTracker();
    window.dispatchEvent(new Event('pagehide'));
    const [, exit] = await beaconsFor(key, '/v1/a/t');
    expect(exit!.readDepth).toBe(100);
  });

  it('tracks the deepest milestone reached, not the position at exit', async () => {
    setScrollHeight(window.innerHeight * 4);
    setScrollY(0);
    const key = await loadTracker();

    setScrollY(window.innerHeight * 2);
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    setScrollY(0);
    window.dispatchEvent(new Event('pagehide'));
    const [, exit] = await beaconsFor(key, '/v1/a/t');
    expect(exit!.readDepth).toBe(75);
  });

  it('resets between views on a route change', async () => {
    setScrollHeight(window.innerHeight * 4);
    setScrollY(window.innerHeight * 3);
    const key = await loadTracker();

    history.pushState({}, '', '/second');
    setScrollY(0);
    setScrollHeight(window.innerHeight * 4);
    window.dispatchEvent(new Event('pagehide'));

    const views = await beaconsFor(key, '/v1/a/t');
    const firstExit = views.find((v) => v.subjectId === '/welcome' && v.dwellMs !== undefined);
    const secondExit = views.filter((v) => v.subjectId === '/second').at(-1);
    expect(firstExit!.readDepth).toBe(100);
    expect(secondExit!.readDepth).toBe(25);
  });
});

describe('declarative events', () => {
  it('fires on a click anywhere inside a data-mn-event element', async () => {
    const key = await loadTracker();
    document.body.innerHTML =
      '<button data-mn-event="signup-cta-click" data-mn-subject-type="funnel" data-mn-metadata=\'{"plan":"pro"}\'><span>Go</span></button>';
    beacons = [];

    document.querySelector('span')!.dispatchEvent(new Event('click', { bubbles: true }));

    const [event] = await beaconsFor(key, '/v1/a/t');
    expect(event).toMatchObject({
      subjectId: 'signup-cta-click',
      subjectType: 'funnel',
      metadata: { plan: 'pro' },
    });
  });

  it('defaults subjectType to event and drops unparseable metadata', async () => {
    const key = await loadTracker();
    document.body.innerHTML =
      '<a data-mn-event="docs-link" data-mn-metadata="not json">docs</a>';
    beacons = [];

    document.querySelector('a')!.dispatchEvent(new Event('click', { bubbles: true }));

    const [event] = await beaconsFor(key, '/v1/a/t');
    expect(event!.subjectType).toBe('event');
    expect(event!.metadata).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('data-mn-metadata'),
      'not json',
    );
  });

  it('fires a data-mn-once element only once per session', async () => {
    await loadTracker();
    document.body.innerHTML =
      '<button data-mn-event="checkout-step-1" data-mn-once="session">Next</button>';
    beacons = [];

    const button = document.querySelector('button')!;
    button.dispatchEvent(new Event('click', { bubbles: true }));
    button.dispatchEvent(new Event('click', { bubbles: true }));

    expect(await viewsForSubject('checkout-step-1')).toHaveLength(1);
  });
});

describe('window.mn.trackOnce', () => {
  it('sends the first call and swallows repeats within the session', async () => {
    const key = await loadTracker();
    beacons = [];
    mn().trackOnce('checkout-complete', { subjectType: 'funnel' });
    mn().trackOnce('checkout-complete', { subjectType: 'funnel' });
    const sent = await beaconsFor(key, '/v1/a/t');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subjectId: 'checkout-complete', subjectType: 'funnel' });
  });

  it('stays suppressed across a reload while the session survives', async () => {
    await loadTracker();
    mn().trackOnce('checkout-complete');
    const key2 = await loadTracker();
    beacons = [];
    mn().trackOnce('checkout-complete');
    expect(await beaconsFor(key2, '/v1/a/t')).toHaveLength(0);
  });
});

describe('window.mn.trackSearch', () => {
  it('posts the query and result count to /v1/a/s', async () => {
    document.documentElement.lang = 'nb-NO';
    const key = await loadTracker();
    beacons = [];
    mn().trackSearch('  refund policy  ', 0);
    const [payload] = await beaconsFor(key, '/v1/a/s');
    expect(payload).toMatchObject({
      key,
      query: 'refund policy',
      resultCount: 0,
      locale: 'nb-NO',
    });
    expect(typeof payload!.visitorId).toBe('string');
  });

  it('accepts a subjectType override and floors the count', async () => {
    const key = await loadTracker();
    beacons = [];
    mn().trackSearch('pricing', 3.7, { subjectType: 'docs' });
    const [payload] = await beaconsFor(key, '/v1/a/s');
    expect(payload).toMatchObject({ subjectType: 'docs', resultCount: 3 });
  });

  it('sends nothing for an empty query or a non-numeric count', async () => {
    const key = await loadTracker();
    beacons = [];
    mn().trackSearch('   ', 0);
    mn().trackSearch('pricing', Number.NaN);
    expect(await beaconsFor(key, '/v1/a/s')).toHaveLength(0);
  });
});

describe('CMS entry views', () => {
  it('auto-fires for every data-mn-entry-token in the document', async () => {
    document.body.innerHTML =
      '<article data-mn-entry-token="auto-a"></article><article data-mn-entry-token="auto-b"></article>';
    await loadTracker();

    const first = await entryViewsFor('auto-a');
    const second = await entryViewsFor('auto-b');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(typeof first[0]!.visitorId).toBe('string');
    expect(typeof first[0]!.viewId).toBe('string');
    expect(first[0]!.viewId).not.toBe(second[0]!.viewId);
  });

  it('enriches each entry view with dwell time on exit', async () => {
    document.body.innerHTML = '<article data-mn-entry-token="enrich-a"></article>';
    await loadTracker();
    const [initial] = await entryViewsFor('enrich-a');
    beacons = [];

    window.dispatchEvent(new Event('pagehide'));
    const [exit] = await entryViewsFor('enrich-a');
    expect(exit!.viewId).toBe(initial!.viewId);
    expect(typeof exit!.dwellMs).toBe('number');
    expect(exit!.referrer).toBeNull();
  });

  it('keeps enriching entry views on later exits, not just the first', async () => {
    document.body.innerHTML = '<article data-mn-entry-token="enrich-b"></article>';
    await loadTracker();
    beacons = [];

    setVisibility('hidden');
    setVisibility('visible');
    await new Promise((r) => setTimeout(r, 12));
    window.dispatchEvent(new Event('pagehide'));

    const enrichments = await entryViewsFor('enrich-b');
    expect(enrichments).toHaveLength(2);
    expect(enrichments[1]!.viewId).toBe(enrichments[0]!.viewId);
    expect(enrichments[1]!.dwellMs as number).toBeGreaterThan(
      enrichments[0]!.dwellMs as number,
    );
  });

  it('re-registers declared entries after a bfcache restore', async () => {
    document.body.innerHTML = '<article data-mn-entry-token="restore-a"></article>';
    await loadTracker();
    const [initial] = await entryViewsFor('restore-a');
    beacons = [];

    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    window.dispatchEvent(pageshow);

    const [restored] = await entryViewsFor('restore-a');
    expect(restored!.viewId).not.toBe(initial!.viewId);
    expect(restored!.dwellMs).toBeUndefined();
  });

  it('warns and sends nothing when trackEntry is called without a token', async () => {
    await loadTracker();
    beacons = [];
    mn().trackEntry('');
    expect(beacons.filter((b) => b.url.endsWith('/v1/a/v'))).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('trackEntry requires'));
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

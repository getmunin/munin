interface TrackAttrs {
  subjectType?: string;
  path?: string;
  referrer?: string | null;
  dwellMs?: number;
  readDepth?: number;
  viewId?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  metadata?: Record<string, unknown>;
}

interface BeaconPayload {
  key: string;
  subjectType: string;
  subjectId: string;
  path: string;
  referrer: string | null;
  visitorId: string | null;
  locale: string | undefined;
  dwellMs?: number;
  readDepth?: number;
  viewId?: string;
  utm: { source?: string; medium?: string; campaign?: string };
  metadata?: Record<string, unknown>;
}

interface EntryPayload {
  token: string;
  path: string;
  referrer: string | null;
  visitorId: string;
  locale: string | undefined;
  dwellMs?: number;
  readDepth?: number;
  viewId: string;
  metadata?: Record<string, unknown>;
}

interface SearchPayload {
  key: string;
  query: string;
  resultCount: number;
  subjectType?: string;
  locale: string | undefined;
  visitorId: string;
}

interface SearchOpts {
  subjectType?: string;
  locale?: string;
}

interface MuninGlobal {
  track: (subjectId: string, attrs?: TrackAttrs) => void;
  trackOnce: (subjectId: string, attrs?: TrackAttrs) => void;
  trackPageView: () => void;
  trackSearch: (query: string, resultCount: number, opts?: SearchOpts) => void;
  trackEntry: (token: string, attrs?: TrackAttrs) => void;
  getVisitorId: () => string;
  identify: (externalId: string, userHash: string) => void;
  ready: boolean;
}

interface IdentifyPayload {
  key: string;
  visitorId: string;
  externalId: string;
  userHash: string;
}

const VISITOR_KEY = 'mn.vid';
const LOG_PREFIX = '[munin-tracker] ';
const ONCE_PREFIX = 'mn.once.';
const MAX_ENTRY_VIEWS = 10;

function warn(message: string, ...detail: unknown[]): void {
  console.warn(LOG_PREFIX + message, ...detail);
}

(function init(): void {
  const doc = document;
  const script = doc.currentScript as HTMLScriptElement | null;
  if (!script) {
    warn('document.currentScript unavailable; tracker disabled');
    return;
  }
  const key = script.getAttribute('data-key');
  if (!key) {
    warn('data-key attribute missing on script tag; tracker disabled');
    return;
  }

  let apiBase = script.getAttribute('data-api');
  if (!apiBase) {
    try {
      apiBase = new URL(script.src).origin;
    } catch (err) {
      warn('could not resolve data-api or script.src origin:', err);
      return;
    }
  }
  apiBase = apiBase.replace(/\/+$/, '');

  const subjectType = script.getAttribute('data-subject-type') || 'page';
  const spa = script.getAttribute('data-spa') === 'true';
  const trackDepth = script.getAttribute('data-read-depth') === 'true';
  const beaconUrl = apiBase + '/v1/a/t';
  const identifyUrl = apiBase + '/v1/a/identify';
  const searchUrl = apiBase + '/v1/a/s';
  const entryUrl = apiBase + '/v1/a/v';

  function uuid(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  let visitorId: string;
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored) {
      visitorId = stored;
    } else {
      visitorId = uuid();
      localStorage.setItem(VISITOR_KEY, visitorId);
    }
  } catch {
    visitorId = uuid();
  }

  const initialReferrer = doc.referrer || null;
  let pageEnter = Date.now();
  let lastPath = location.pathname;
  let pageViewId = uuid();
  let maxDepth = 0;
  const firedOnce = new Set<string>();
  const entryViews: Array<{ token: string; viewId: string }> = [];

  function post(url: string, payload: unknown): void {
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(url, blob);
        return;
      }
      void fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: true,
        mode: 'no-cors',
      }).catch((err) => {
        warn('beacon fetch failed:', err);
      });
    } catch (err) {
      warn('failed to send beacon:', err);
    }
  }

  function readUtm(): { source?: string; medium?: string; campaign?: string } {
    try {
      const p = new URLSearchParams(location.search);
      return {
        source: p.get('utm_source') || undefined,
        medium: p.get('utm_medium') || undefined,
        campaign: p.get('utm_campaign') || undefined,
      };
    } catch {
      return {};
    }
  }

  function locale(): string | undefined {
    return doc.documentElement.lang || undefined;
  }

  function trackView(subjectId: string, attrs: TrackAttrs = {}): void {
    const payload: BeaconPayload = {
      key: key!,
      subjectType: attrs.subjectType || subjectType,
      subjectId,
      path: attrs.path || location.pathname + location.search,
      referrer: attrs.referrer !== undefined ? attrs.referrer : initialReferrer,
      visitorId,
      locale: locale(),
      dwellMs: attrs.dwellMs,
      readDepth: attrs.readDepth,
      viewId: attrs.viewId,
      utm: attrs.utm || readUtm(),
      metadata: attrs.metadata,
    };
    post(beaconUrl, payload);
  }

  function depthNow(): number {
    const height = doc.documentElement.scrollHeight;
    if (!height) return 0;
    const seen = ((window.scrollY || 0) + window.innerHeight) / height;
    const pct = Math.min(100, Math.round(seen * 100));
    return pct >= 100 ? 100 : pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0;
  }

  function readDepth(): number | undefined {
    if (!trackDepth) return undefined;
    maxDepth = Math.max(maxDepth, depthNow());
    return maxDepth;
  }

  if (trackDepth) {
    let pending = 0;
    const sample = (): void => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        maxDepth = Math.max(maxDepth, depthNow());
      });
    };
    addEventListener('scroll', sample, { passive: true });
    addEventListener('resize', sample, { passive: true });
  }

  function startView(referrer?: string | null): void {
    pageViewId = uuid();
    pageEnter = Date.now();
    lastPath = location.pathname;
    maxDepth = 0;
    trackView(location.pathname, { viewId: pageViewId, referrer });
  }

  function trackPageView(): void {
    startView();
  }

  function endView(): void {
    const dwellMs = Date.now() - pageEnter;
    const depth = readDepth();
    trackView(lastPath, {
      dwellMs,
      readDepth: depth,
      viewId: pageViewId,
      referrer: null,
    });
    flushEntryViews(dwellMs, depth);
  }

  function sendEntry(token: string, viewId: string, attrs: TrackAttrs = {}): void {
    const payload: EntryPayload = {
      token,
      path: attrs.path || location.pathname + location.search,
      referrer: attrs.referrer !== undefined ? attrs.referrer : initialReferrer,
      visitorId,
      locale: locale(),
      dwellMs: attrs.dwellMs,
      readDepth: attrs.readDepth,
      viewId,
      metadata: attrs.metadata,
    };
    post(entryUrl, payload);
  }

  function trackEntry(token: string, attrs: TrackAttrs = {}): void {
    if (!token) {
      warn('trackEntry requires a _tracking.token');
      return;
    }
    const viewId = attrs.viewId || uuid();
    sendEntry(token, viewId, attrs);
    if (entryViews.length < MAX_ENTRY_VIEWS) entryViews.push({ token, viewId });
  }

  function flushEntryViews(dwellMs: number, depth: number | undefined): void {
    for (const view of entryViews) {
      sendEntry(view.token, view.viewId, { dwellMs, readDepth: depth, referrer: null });
    }
    entryViews.length = 0;
  }

  function trackDeclaredEntries(): void {
    doc.querySelectorAll('[data-mn-entry-token]').forEach((el) => {
      const token = el.getAttribute('data-mn-entry-token');
      if (token) trackEntry(token);
    });
  }

  function claimOnce(subjectId: string): boolean {
    if (firedOnce.has(subjectId)) return false;
    firedOnce.add(subjectId);
    try {
      const storageKey = ONCE_PREFIX + subjectId;
      if (sessionStorage.getItem(storageKey)) return false;
      sessionStorage.setItem(storageKey, '1');
    } catch {
      return true;
    }
    return true;
  }

  function trackOnce(subjectId: string, attrs: TrackAttrs = {}): void {
    if (claimOnce(subjectId)) trackView(subjectId, attrs);
  }

  function trackSearch(query: string, resultCount: number, opts: SearchOpts = {}): void {
    const q = (query || '').trim();
    if (!q) return;
    if (!Number.isFinite(resultCount)) {
      warn('trackSearch requires a numeric resultCount');
      return;
    }
    const payload: SearchPayload = {
      key: key!,
      query: q.slice(0, 256),
      resultCount: Math.max(0, Math.floor(resultCount)),
      subjectType: opts.subjectType,
      locale: opts.locale || locale(),
      visitorId,
    };
    post(searchUrl, payload);
  }

  function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      warn('data-mn-metadata is not a JSON object:', raw);
      return undefined;
    }
  }

  doc.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest('[data-mn-event]');
      if (!el) return;
      const subjectId = el.getAttribute('data-mn-event');
      if (!subjectId) return;
      const attrs: TrackAttrs = {
        subjectType: el.getAttribute('data-mn-subject-type') || 'event',
        metadata: parseMetadata(el.getAttribute('data-mn-metadata')),
      };
      if (el.getAttribute('data-mn-once')) trackOnce(subjectId, attrs);
      else trackView(subjectId, attrs);
    },
    true,
  );

  function identify(externalId: string, userHash: string): void {
    if (!externalId || !userHash) {
      warn('identify requires externalId and userHash');
      return;
    }
    const payload: IdentifyPayload = {
      key: key!,
      visitorId,
      externalId,
      userHash,
    };
    post(identifyUrl, payload);
  }

  function onLoad(): void {
    trackPageView();
    trackDeclaredEntries();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', onLoad, { once: true });
  } else {
    onLoad();
  }

  if (spa) {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    function onRouteChange(): void {
      if (location.pathname === lastPath) return;
      endView();
      startView(null);
    }
    history.pushState = function (...args): void {
      origPush(...args);
      onRouteChange();
    };
    history.replaceState = function (...args): void {
      origReplace(...args);
      onRouteChange();
    };
    addEventListener('popstate', onRouteChange);
  }

  addEventListener('pagehide', endView);

  addEventListener('pageshow', (event) => {
    if (event.persisted) startView(null);
  });

  const w = window as Window & { mn?: Partial<MuninGlobal> };
  const mn = (w.mn ??= {});
  mn.track = trackView;
  mn.trackOnce = trackOnce;
  mn.trackPageView = trackPageView;
  mn.trackSearch = trackSearch;
  mn.trackEntry = trackEntry;
  mn.getVisitorId = (): string => visitorId;
  const previousIdentify = mn.identify;
  mn.identify = (externalId: string, userHash: string): void => {
    identify(externalId, userHash);
    if (previousIdentify) {
      try {
        previousIdentify(externalId, userHash);
      } catch (err) {
        warn('forward identify:', err);
      }
    }
  };
  mn.ready = true;
  doc.dispatchEvent(new CustomEvent('munin:ready'));
})();

export {};

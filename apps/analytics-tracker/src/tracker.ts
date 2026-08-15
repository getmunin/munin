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

interface MuninAnalyticsApi {
  track: (subjectId: string, attrs?: TrackAttrs) => void;
  trackOnce: (subjectId: string, attrs?: TrackAttrs) => void;
  trackPageView: () => void;
  trackSearch: (query: string, resultCount: number, opts?: SearchOpts) => void;
  trackEntry: (token: string, attrs?: TrackAttrs) => void;
  getVisitorId: () => string;
  identify: (externalId: string, userHash: string, traits?: IdentifyTraits) => void;
  ready: boolean;
}

interface IdentifyTraits {
  email?: string | null;
}

interface IdentifyPayload {
  key: string;
  visitorId: string;
  externalId: string;
  userHash: string;
  email?: string;
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
  let activeMs = 0;
  let visibleSince = doc.visibilityState === 'hidden' ? 0 : Date.now();
  let lastPath = location.pathname;
  let pageViewId = uuid();
  let maxDepth = 0;
  let reported = false;
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

  function postIdentify(url: string, payload: unknown): void {
    try {
      void fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
        .then((res) => {
          if (res.ok || res.status === 204) return;
          warn(
            `identify rejected by the server (HTTP ${res.status}) — check that userHash was signed ` +
              `with this tracker's identity secret over the mn.identity.v1 payload, and that this ` +
              `origin is on the tracker's allowlist`,
          );
        })
        .catch((err) => {
          warn('identify request failed:', err);
        });
    } catch (err) {
      warn('failed to send identify:', err);
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

  function readDepth(): number {
    maxDepth = Math.max(maxDepth, depthNow());
    return maxDepth;
  }

  let pendingSample = 0;
  const sampleDepth = (): void => {
    if (pendingSample) return;
    pendingSample = requestAnimationFrame(() => {
      pendingSample = 0;
      maxDepth = Math.max(maxDepth, depthNow());
    });
  };
  addEventListener('scroll', sampleDepth, { passive: true });
  addEventListener('resize', sampleDepth, { passive: true });

  function startView(referrer?: string | null): void {
    pageViewId = uuid();
    activeMs = 0;
    visibleSince = doc.visibilityState === 'hidden' ? 0 : Date.now();
    lastPath = location.pathname;
    maxDepth = 0;
    reported = false;
    entryViews.length = 0;
    trackView(location.pathname, { viewId: pageViewId, referrer });
  }

  function trackPageView(): void {
    startView();
  }

  function dwellNow(): number {
    return activeMs + (visibleSince ? Date.now() - visibleSince : 0);
  }

  function endView(): void {
    if (reported) return;
    reported = true;
    const dwellMs = dwellNow();
    const depth = readDepth();
    trackView(lastPath, {
      dwellMs,
      readDepth: depth,
      viewId: pageViewId,
      referrer: null,
    });
    for (const view of entryViews) {
      sendEntry(view.token, view.viewId, { dwellMs, readDepth: depth, referrer: null });
    }
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

  function identify(externalId: string, userHash: string, traits?: IdentifyTraits): void {
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
    const email = traits?.email?.trim();
    if (email) payload.email = email;
    postIdentify(identifyUrl, payload);
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

  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      if (visibleSince) {
        activeMs += Date.now() - visibleSince;
        visibleSince = 0;
      }
      endView();
    } else {
      visibleSince = Date.now();
      reported = false;
    }
  });
  addEventListener('pagehide', endView);

  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    startView(null);
    trackDeclaredEntries();
  });

  const w = window as Window & { mn?: { analytics?: MuninAnalyticsApi } };
  const mn = (w.mn ??= {});
  if (mn.analytics) {
    warn('window.mn.analytics is already installed by another tracker on this page; ignoring');
    return;
  }
  mn.analytics = {
    track: trackView,
    trackOnce,
    trackPageView,
    trackSearch,
    trackEntry,
    getVisitorId: (): string => visitorId,
    identify,
    ready: true,
  };
  doc.dispatchEvent(new CustomEvent('munin:analytics-ready'));
})();

export {};

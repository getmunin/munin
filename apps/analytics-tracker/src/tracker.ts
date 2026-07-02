/**
 * Munin analytics tracker — drop-in browser script.
 *
 * Embedded as `<script async src="…/tracker.js" data-key="mn_track_…">`.
 * Auto-fires a page view on DOMContentLoaded, captures referrer + UTM +
 * locale, persists a random visitor id in localStorage, and reports
 * best-effort dwell time on `pagehide`. Optional SPA mode hooks
 * `history.pushState` / `replaceState` so route changes fire fresh
 * views.
 *
 * Exposes `window.mn.track(subjectId, attrs)` for custom events. Once the
 * public API is installed it sets `window.mn.ready = true` and dispatches a
 * `munin:ready` CustomEvent on `document`, so consumers can run
 * initialization code without polling:
 *
 *   window.mn?.ready
 *     ? go()
 *     : document.addEventListener('munin:ready', go, { once: true });
 */

interface TrackAttrs {
  subjectType?: string;
  path?: string;
  referrer?: string | null;
  dwellMs?: number;
  readDepth?: number;
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
  utm: { source?: string; medium?: string; campaign?: string };
  metadata?: Record<string, unknown>;
}

interface MuninGlobal {
  track: (subjectId: string, attrs?: TrackAttrs) => void;
  trackPageView: () => void;
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

(function init(): void {
  const doc = document;
  const script = doc.currentScript as HTMLScriptElement | null;
  if (!script) {
    console.warn('[munin-tracker] document.currentScript unavailable; tracker disabled');
    return;
  }
  const key = script.getAttribute('data-key');
  if (!key) {
    console.warn('[munin-tracker] data-key attribute missing on script tag; tracker disabled');
    return;
  }

  let apiBase = script.getAttribute('data-api');
  if (!apiBase) {
    try {
      apiBase = new URL(script.src).origin;
    } catch (err) {
      console.warn('[munin-tracker] could not resolve data-api or script.src origin:', err);
      return;
    }
  }
  apiBase = apiBase.replace(/\/+$/, '');

  const subjectType = script.getAttribute('data-subject-type') || 'page';
  const spa = script.getAttribute('data-spa') === 'true';
  const beaconUrl = apiBase + '/v1/a/t';
  const identifyUrl = apiBase + '/v1/a/identify';

  function freshVisitorId(): string {
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
      visitorId = freshVisitorId();
      localStorage.setItem(VISITOR_KEY, visitorId);
    }
  } catch {
    // localStorage threw (private window, embedded WebView, locked-down
    // enterprise browser, storage quota). Fall back to a page-scoped id so
    // pageviews within the same page lifetime still dedup to one visitor.
    // Lost on reload — that's the inherent cost of no persistent storage.
    visitorId = freshVisitorId();
  }

  const initialReferrer = doc.referrer || null;
  let pageEnter = Date.now();
  let lastPath = location.pathname;

  function send(payload: BeaconPayload): void {
    try {
      const body = JSON.stringify(payload);
      // text/plain is in the CORS "safelisted" Content-Type set, so neither
      // sendBeacon (which always sends cookies) nor fetch trigger a preflight.
      // application/json would force a preflight that fails because the
      // beacon endpoint is a public-CORS path and does not return
      // Access-Control-Allow-Credentials. The server JSON-parses text/plain
      // bodies on the beacon route — see bootstrap-app.ts body-parser config.
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(beaconUrl, blob);
        return;
      }
      void fetch(beaconUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: true,
        mode: 'no-cors',
      }).catch((err) => {
        console.warn('[munin-tracker] beacon fetch failed:', err);
      });
    } catch (err) {
      console.warn('[munin-tracker] failed to send beacon:', err);
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

  function trackView(subjectId: string, attrs: TrackAttrs = {}): void {
    send({
      key: key!,
      subjectType: attrs.subjectType || subjectType,
      subjectId,
      path: attrs.path || location.pathname + location.search,
      referrer: attrs.referrer !== undefined ? attrs.referrer : initialReferrer,
      visitorId,
      locale: doc.documentElement.lang || undefined,
      dwellMs: attrs.dwellMs,
      readDepth: attrs.readDepth,
      utm: attrs.utm || readUtm(),
      metadata: attrs.metadata,
    });
  }

  function trackPageView(): void {
    trackView(location.pathname);
  }

  function identify(externalId: string, userHash: string): void {
    if (!externalId || !userHash) {
      console.warn('[munin-tracker] identify requires externalId and userHash');
      return;
    }
    const payload: IdentifyPayload = {
      key: key!,
      visitorId,
      externalId,
      userHash,
    };
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(identifyUrl, blob);
        return;
      }
      void fetch(identifyUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: true,
        mode: 'no-cors',
      }).catch((err) => {
        console.warn('[munin-tracker] identify fetch failed:', err);
      });
    } catch (err) {
      console.warn('[munin-tracker] failed to send identify:', err);
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', trackPageView, { once: true });
  } else {
    trackPageView();
  }

  if (spa) {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    function onRouteChange(): void {
      if (location.pathname === lastPath) return;
      const dwell = Date.now() - pageEnter;
      pageEnter = Date.now();
      lastPath = location.pathname;
      trackView(location.pathname, { dwellMs: dwell, referrer: null });
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

  addEventListener('pagehide', () => {
    const dwell = Date.now() - pageEnter;
    trackView(lastPath, { dwellMs: dwell, referrer: null });
  });

  const w = window as Window & { mn?: Partial<MuninGlobal> };
  const mn = (w.mn ??= {});
  mn.track = trackView;
  mn.trackPageView = trackPageView;
  mn.getVisitorId = (): string => visitorId;
  const previousIdentify = mn.identify;
  mn.identify = (externalId: string, userHash: string): void => {
    identify(externalId, userHash);
    if (previousIdentify) {
      try {
        previousIdentify(externalId, userHash);
      } catch (err) {
        console.warn('[munin-tracker] forward identify:', err);
      }
    }
  };
  mn.ready = true;
  doc.dispatchEvent(new CustomEvent('munin:ready'));
})();

export {};


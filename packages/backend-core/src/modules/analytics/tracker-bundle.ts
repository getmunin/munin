export const TRACKER_JS = `(function(){
  var doc = document;
  var script = doc.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-key');
  if (!key) return;
  var apiBase = script.getAttribute('data-api');
  if (!apiBase) {
    try {
      var u = new URL(script.src);
      apiBase = u.origin;
    } catch (e) { return; }
  }
  apiBase = apiBase.replace(/\\/+$/, '');
  var subjectType = script.getAttribute('data-subject-type') || 'page';
  var spa = script.getAttribute('data-spa') === 'true';

  var beaconUrl = apiBase + '/v1/a/t';
  var visitorKey = 'mn.vid';
  var visitorId;
  try {
    visitorId = localStorage.getItem(visitorKey);
    if (!visitorId) {
      visitorId = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('v-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(visitorKey, visitorId);
    }
  } catch (e) { visitorId = null; }

  var initialReferrer = doc.referrer || null;
  var pageEnter = Date.now();
  var lastPath = location.pathname;

  function send(payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(beaconUrl, blob);
        return;
      }
      fetch(beaconUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'no-cors',
      }).catch(function(){});
    } catch (e) {}
  }

  function readUtm() {
    try {
      var p = new URLSearchParams(location.search);
      return {
        source: p.get('utm_source') || undefined,
        medium: p.get('utm_medium') || undefined,
        campaign: p.get('utm_campaign') || undefined,
      };
    } catch (e) { return {}; }
  }

  function trackView(subjectId, attrs) {
    attrs = attrs || {};
    var utm = attrs.utm || readUtm();
    send({
      key: key,
      subjectType: attrs.subjectType || subjectType,
      subjectId: subjectId,
      path: attrs.path || location.pathname + location.search,
      referrer: attrs.referrer != null ? attrs.referrer : initialReferrer,
      visitorId: visitorId,
      locale: doc.documentElement.lang || undefined,
      dwellMs: attrs.dwellMs,
      readDepth: attrs.readDepth,
      utm: utm,
      metadata: attrs.metadata,
    });
  }

  function trackPageView() {
    trackView(location.pathname);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', trackPageView, { once: true });
  } else {
    trackPageView();
  }

  if (spa) {
    var origPush = history.pushState;
    var origReplace = history.replaceState;
    function onRouteChange() {
      if (location.pathname === lastPath) return;
      var dwell = Date.now() - pageEnter;
      pageEnter = Date.now();
      lastPath = location.pathname;
      trackView(location.pathname, { dwellMs: dwell, referrer: null });
    }
    history.pushState = function() { origPush.apply(this, arguments); onRouteChange(); };
    history.replaceState = function() { origReplace.apply(this, arguments); onRouteChange(); };
    addEventListener('popstate', onRouteChange);
  }

  // Best-effort dwell time on unload.
  addEventListener('pagehide', function() {
    var dwell = Date.now() - pageEnter;
    trackView(lastPath, { dwellMs: dwell, referrer: null });
  });

  var mn = window.mn || (window.mn = {});
  mn.track = trackView;
  mn.trackPageView = trackPageView;
})();
`;

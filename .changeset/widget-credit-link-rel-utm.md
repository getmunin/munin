---
'@getmunin/chat-widget': patch
---

Mark the widget's "Powered by Munin" links `rel="nofollow noopener"` and tag the href with UTM params.

The credit link is rendered into every embedding site's template, which is exactly the pattern Google's link spam guidance calls out as a link scheme ("links embedded in widgets that get distributed across various sites", "links in the footers or templates of various sites"). Googlebot renders JS and flattens open shadow roots, so the link was discoverable and followable — carrying the manipulation risk without any realistic ranking benefit, since widget links are devalued by policy either way. `nofollow` takes that risk off the table at no cost.

Dropping `noreferrer` is the part that gains something: it was stripping the `Referer` header, so every real click landed in analytics as direct traffic with no way to tell which embedding site sent it. With only `noopener` (which is what actually covers the `target="_blank"` security concern), clicks now carry a referrer host and show up in `analytics_list_referrer_hosts`. The href gains `utm_source=widget&utm_medium=referral&utm_campaign=powered_by` — the three params `tracker.js` reads; `utm_content` is deliberately omitted because the tracker ignores it and the referrer host already provides the per-install dimension.

The href also points at the canonical `www.getmunin.com` rather than the apex, which 301s to it — one less redirect hop per click.

Both call sites (welcome eyebrow and panel footer) now build the anchor from one helper, so the href and rel can't drift apart.

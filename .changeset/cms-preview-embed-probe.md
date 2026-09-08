---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Say why a CMS preview will not embed, instead of showing a dead grey frame.

A frontend that sends `Content-Security-Policy: frame-ancestors 'none'` or `X-Frame-Options: DENY` — the default in most security-header snippets, including the one Next.js docs suggest — cannot be framed by the Review pane. Until now that produced a blank grey panel that stayed on the Preview tab forever, with the reason visible only in the browser console.

The pane could not have detected it. Measured in Chromium against a blocked site and an allowed one, the two are indistinguishable from the embedder: both fire `load`, both throw `SecurityError` on `contentWindow.location`, `origin`, `history` and `frameElement`, and both report `contentDocument === null` and `contentWindow.length === 0`. `frameStayedBlank()` only ever worked for a same-origin `about:blank`; on a CSP-blocked cross-origin frame its `catch` returned "not blank", which is what marked the dead frame `ready` and defeated the 15-second timeout behind it.

So the check moves server-side. `POST /v1/cms/drafts/:id/preview-link` now also returns `embed`: `{ embeddable, reason, detail, previewHost, embedderOrigin }`, from one `safeFetch` of the preview URL that reads `Content-Security-Policy` and `X-Frame-Options` and evaluates `frame-ancestors` against `MUNIN_WEB_URL`. The evaluation follows what browsers actually do — every policy in a comma-joined header must allow the embedder, `'self'` is read against the previewed site rather than the dashboard, `X-Frame-Options` is ignored whenever any `frame-ancestors` directive is present, and `ALLOW-FROM` is treated as absent because no current browser honours it. `cms_get_preview_link` is untouched: the probe hangs off the dashboard's controller, so minting a link from an agent still makes no outbound request.

When the verdict is "blocked" the pane skips the frame entirely, opens on the fields, and names the offending header and the origin it refuses — the "open on the site" link keeps working, because a top-level navigation is not framed. A probe that fails for any other reason falls open and behaves as before: a wrong "blocked" banner over a working preview would be worse than the frame we have today.

`skill://cms/preview-entry` gains the frontend side of this as Step 4, along with a second failure it shares. The preview cookie in the skill's own example carried no `sameSite`, which is `Lax` — not sent in a cross-site frame, so once the framing headers are fixed the frame redirects, the cookie never arrives, and the reader gets the published entry with nothing to indicate why. It now sets `SameSite=None; Secure; Partitioned`, as Next's own draft-mode bypass cookie already does. `skill://cms/design-collection` points at it, since both fixes belong to whoever wires the frontend up.

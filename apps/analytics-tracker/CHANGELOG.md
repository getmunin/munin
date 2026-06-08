# @getmunin/analytics-tracker

## 4.42.0

### Patch Changes

- 15d6ed4: When `localStorage` throws (private windows, embedded WebViews, locked-down enterprise browsers, storage quota), the tracker bundle now generates a page-scoped UUID as the visitor id instead of sending `null`. Previously every pageview from a storage-disabled session read as a new visitor, so unique-visitor counts and within-session dedup were broken for that traffic — and SPA route changes from one user looked like N separate visitors.

  The fallback id only survives the page lifetime (no persistent storage to fall back on), so the same user reloading the page still gets counted twice. That's the inherent cost of having no storage; this fix just keeps at least intra-session dedup working. Privacy story is unchanged — the id is a random UUID, never linked to PII.

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

### Patch Changes

- 1fe3019: Fix the analytics tracker beacon failing with `ERR_FAILED` / `Access-Control-Allow-Credentials` errors in production browsers.

  `navigator.sendBeacon` always sends with `credentials: 'include'` (no opt-out), and the previous bundle wrapped its JSON body in a `Blob` with type `application/json`. Since `application/json` is not in the CORS-safelisted Content-Type set, the browser issued a CORS preflight. The beacon endpoint sits under `/v1/a/*`, which `bootstrap-app.ts` treats as a public-CORS path — those echo the request `Origin` but deliberately omit `Access-Control-Allow-Credentials: true` (per CORS spec: wildcard-style origin handling is incompatible with credentials). The preflight therefore failed, and the actual POST never happened. The pixel route (`GET /v1/a/t/:key.gif`) was unaffected because GETs without custom headers don't preflight.

  Coupled fix:
  - **Bundle (`apps/analytics-tracker/src/tracker.ts`)**: emit the body as `text/plain;charset=UTF-8`. That's CORS-safelisted, so `navigator.sendBeacon` (and the `fetch` no-cors fallback) send the request without a preflight, while cookies still come along — the server doesn't read them anyway.
  - **Server (`packages/backend-core/src/bootstrap-app.ts`)**: widen the JSON body parser to also accept `text/plain` bodies. The parser still does `JSON.parse`, so the controller's `@Body() rawBody: unknown` keeps the same shape and the existing Zod schema does the rest. No other endpoints rely on receiving raw `text/plain` today, so the wider type list is a safe extension.

  Integration test updated to use `text/plain;charset=UTF-8` so it exercises the production code path; the `beaconDenied` test still uses `application/json` to keep that path covered.

## 4.40.2

### Patch Changes

- 38e00cd: Tidy up the changesets configuration to cover every workspace package:
  - Add `@getmunin/analytics-tracker` to the `fixed` group so it bumps in lockstep with the rest of the publishable `@getmunin/*` suite. The package was introduced at `4.33.0` and never re-versioned, leaving downstream consumers unable to pin `^4.x` against the same range as `@getmunin/backend-core`. `apps/analytics-tracker/package.json` is manually aligned to `4.40.1` so this release moves the group together.
  - Add `@getmunin/widget-voice` to the `ignore` list. It's `private: true` and already excluded from publishing, but every other private package in the workspace is explicitly ignored — adding it here keeps the config consistent and prevents accidental version-bump noise.

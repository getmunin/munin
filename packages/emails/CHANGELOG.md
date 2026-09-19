# @getmunin/emails

## 5.32.0

## 5.31.0

## 5.30.1

## 5.30.0

## 5.29.0

## 5.28.0

### Patch Changes

- a3881ba: Email the people who can act on an alert when one opens.

  An alert that only appears in the dashboard is only seen by someone already
  looking. Owners get mail for org-scoped faults; a member gets mail for a fault
  on their own account, because nobody else can clear that one for them. The
  two routes follow the same rule that governs visibility, so there is one
  notion of who an alert belongs to rather than two.

  `openAlert` runs inside the caller's request transaction, so sending from
  there would be external I/O inside a transaction — exactly what the event-sink
  rule forbids. An `EventSink` on `org_alert.opened` enqueues into a new
  `alert_notifications` table and a drain worker sends, the same shape as
  `slack_deliveries` and `webhook_deliveries`.

  The enqueue is idempotent by construction rather than by care.
  `org_alert.opened` is emitted only when a row is first inserted and never on an
  occurrence bump, so a fault that repeats two hundred times enqueues once; the
  unique key on `(alert_id, recipient_user_id)` is the backstop rather than the
  mechanism. The worker also re-reads the alert at send time and closes the
  notification silently if it has already resolved, so a fault that fixes itself
  inside one poll interval sends nothing.

  Because rows are only ever enqueued by the sink, a deploy does not mail anyone
  about alerts that were already open when it shipped — the queue starts empty
  and fills from the next alert onward.

  Not every alert is worth an inbox. `NOTIFY_POLICY` is keyed per source: the
  existing channel and provider sources notify on `error` only, `curator` never
  notifies, and `social` notifies from `warning` because an expiring credential
  needs a person before it becomes an outage. `MUNIN_ALERT_EMAILS_DISABLED`
  switches the whole path off; a per-member preference can follow if anyone
  wants one.

  The alert's own `title` and `detail` are composed in English by whichever
  service raised it, so only the email's chrome is localised. Translating the
  body properly means replacing `title` with a key plus parameters across every
  existing call site, which is unrelated work.

  Two things in `@getmunin/emails` are worth knowing. `pickLocale` returns
  `typeof en`, so `nb` is structurally checked against `en` and a missing or
  mistyped string fails the build — but TypeScript accepts a function that takes
  _fewer_ parameters than the one it is assigned to, so an `nb` string that
  silently drops an interpolation argument typechecks and then renders without
  the value. `locale parity` covers exactly that gap and nothing TypeScript
  already handles.

## 5.27.0

## 5.26.0

### Patch Changes

- 7572eb4: Stop shipping test files in published tarballs.

  Every package listed `src` and/or `dist` in `files` with no `.npmignore`, so each
  tarball carried the full test suite: `@getmunin/agent-runtime` published 226 files
  of which 100 were `*.test.ts`, `*.test.js`, their declaration files and source maps.
  Test fixtures are the one place a repository accumulates captured real-world
  data — addresses, names, message bodies — and a published tarball is immutable,
  so anything that reaches one cannot later be edited or rewritten out.

  `files` now carries `!**/*.test.*` (plus `!src/test/**` for `@getmunin/dashboard-pages`,
  whose render and fixture helpers live there). No published entry point referenced
  either: `@getmunin/dashboard-pages` exposes only `.`, `./server`, `./setup-gate`
  and `./messages/*.json`, and nothing in this repo or munin-cloud imports a test
  file across a package boundary. `@getmunin/agent-runtime` drops to 126 files,
  `@getmunin/backend-core` and `@getmunin/dashboard-pages` to zero test files each.

## 5.25.1

## 5.25.0

## 5.24.1

## 5.24.0

## 5.23.3

## 5.23.2

## 5.23.1

## 5.23.0

## 5.22.0

## 5.21.0

## 5.20.0

## 5.19.0

## 5.18.0

## 5.17.0

## 5.16.0

## 5.15.0

### Patch Changes

- 3252cd1: Bump Next.js to 16.3.4 and other dependencies to their latest compatible minor/patch versions.

## 5.14.0

## 5.13.1

## 5.13.0

## 5.12.0

## 5.11.0

## 5.10.0

## 5.9.0

## 5.8.0

## 5.7.0

## 5.6.0

## 5.5.0

## 5.4.0

## 5.3.0

## 5.2.2

## 5.2.1

## 5.2.0

## 5.1.0

## 5.0.2

## 5.0.1

## 5.0.0

## 4.81.0

## 4.80.1

## 4.80.0

## 4.79.0

## 4.78.0

## 4.77.0

## 4.76.0

## 4.75.0

## 4.74.0

## 4.73.0

## 4.72.0

## 4.71.0

## 4.70.1

## 4.70.0

## 4.69.3

## 4.69.2

## 4.69.1

## 4.69.0

## 4.68.0

## 4.67.2

## 4.67.1

## 4.67.0

## 4.66.1

## 4.66.0

## 4.65.0

## 4.64.0

## 4.63.1

## 4.63.0

## 4.62.1

## 4.62.0

## 4.61.1

## 4.61.0

## 4.60.0

## 4.59.2

## 4.59.1

## 4.59.0

## 4.58.0

## 4.57.1

## 4.57.0

## 4.56.1

## 4.56.0

### Patch Changes

- ccbc3a4: Update UI runtime dependencies within range: lucide-react 1.21, @base-ui/react 1.6, tailwind-merge 3.6, next-intl 4.13, and @react-email/render 2.0.9.

## 4.55.0

## 4.54.0

## 4.53.0

## 4.52.1

## 4.52.0

## 4.51.4

## 4.51.3

## 4.51.2

## 4.51.1

## 4.51.0

## 4.50.1

## 4.50.0

## 4.49.0

## 4.48.0

## 4.47.0

## 4.46.0

## 4.45.1

## 4.45.0

## 4.44.1

## 4.44.0

## 4.43.2

## 4.43.1

## 4.43.0

## 4.42.0

## 4.41.1

## 4.41.0

## 4.40.4

## 4.40.3

## 4.40.2

## 4.40.1

## 4.40.0

## 4.39.0

## 4.38.0

## 4.37.0

## 4.36.0

## 4.35.0

## 4.34.0

## 4.33.0

## 4.32.0

## 4.31.0

## 4.30.0

## 4.23.6

### Patch Changes

- 47e5b30: Point the default email logo URL at `https://www.getmunin.com/email-assets/raven-flying.png` (was the apex `getmunin.com`). The apex's HTTP→HTTPS redirect on the LB ACL already forwarded to `www.`, but going directly avoids the extra hop and the brief render gap some mail clients show when an image URL redirects. `MUNIN_EMAIL_LOGO_URL` still overrides the default — set it for self-hosters who don't own getmunin.com.

## 4.23.5

### Patch Changes

- f25821e: Add `react-dom` as a direct dependency of `@getmunin/emails`.

  `@react-email/render` declares it as a peer (used internally for `renderToStaticMarkup`). The package's own tests passed because the workspace hoists `react-dom` into the root, but consumer Docker images that install only production deps for a single workspace target (cloud's `backend-cloud`) never pulled it in, so `render()` threw at runtime and BetterAuth swallowed the failure — end-user symptom: forgot-password / verify / delete-account / partner-claim emails silently dropped on prod after the 4.23.4 cutover.

  Now declared explicitly so every consumer gets it transitively.

## 4.23.4

### Patch Changes

- 6dfabd2: Introduce `@getmunin/emails`: a shared React Email package that owns every transactional template Munin sends.
  - New templates (en + nb where applicable, all returning `{ subject, html, text }`):
    `renderResetPasswordEmail`, `renderVerifyEmail`, `renderDeleteAccountEmail`,
    `renderOrgInviteEmail`, `renderChannelTestEmail`, `renderPartnerClaimEmail`.
  - Org invite + channel-test now ship HTML alongside plaintext, matching the design system (serif heading, mono eyebrow, accent CTA, fallback URL block, footer attribution).
  - Org invite is now localized (en + nb) — was English-only. The "inviter name" prefix is rendered when the controller can resolve the inviting user.
  - `apps/backend/src/auth/email-templates.ts` deleted; OSS auth flow now calls into `@getmunin/emails`.
  - `MUNIN_EMAIL_LOGO_URL` env (optional) overrides the raven asset URL — useful for self-hosters that don't want the request to leave their network.
  - Self-host setting: BetterAuth's `sendResetPassword` and `sendVerificationEmail` hooks now produce HTML mail in addition to text.
  - OSS dashboard gains `(auth)/forgot-password` and `(auth)/reset-password` pages (ported from cloud) plus a `(auth)/verify-email` landing page; "Forgot your password?" link added under the login password field. `auth.forgotPassword`, `auth.resetPassword`, and `auth.verifyEmail` i18n keys added to `dashboard-pages/src/messages/{en,nb}.json`.

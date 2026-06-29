# @getmunin/emails

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

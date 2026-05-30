---
'@getmunin/emails': patch
'@getmunin/core': patch
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Introduce `@getmunin/emails`: a shared React Email package that owns every transactional template Munin sends.

- New templates (en + nb where applicable, all returning `{ subject, html, text }`):
  `renderResetPasswordEmail`, `renderVerifyEmail`, `renderDeleteAccountEmail`,
  `renderOrgInviteEmail`, `renderChannelTestEmail`, `renderPartnerClaimEmail`.
- Org invite + channel-test now ship HTML alongside plaintext, matching the design system (serif heading, mono eyebrow, accent CTA, fallback URL block, footer attribution).
- Org invite is now localized (en + nb) — was English-only. The "inviter name" prefix is rendered when the controller can resolve the inviting user.
- `apps/backend/src/auth/email-templates.ts` deleted; OSS auth flow now calls into `@getmunin/emails`.
- `MUNIN_EMAIL_LOGO_URL` env (optional) overrides the raven asset URL — useful for self-hosters that don't want the request to leave their network.
- Self-host setting: BetterAuth's `sendResetPassword` and `sendVerificationEmail` hooks now produce HTML mail in addition to text.
- OSS dashboard gains `(auth)/forgot-password` and `(auth)/reset-password` pages (ported from cloud) plus a `(auth)/verify-email` landing page; "Forgot your password?" link added under the login password field. `auth.forgotPassword`, `auth.resetPassword`, and `auth.verifyEmail` i18n keys added to `dashboard-pages/src/messages/{en,nb}.json`.

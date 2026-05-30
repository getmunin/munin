export {
  EMAIL_LOCALES,
  defaultEmailLocale,
  isEmailLocale,
  type EmailLocale,
} from './locales/index.ts';
export type { RenderedEmail } from './render.ts';
export {
  renderResetPasswordEmail,
  type ResetPasswordEmailInput,
} from './templates/reset-password.tsx';
export {
  renderVerifyEmail,
  type VerifyEmailInput,
} from './templates/verify-email.tsx';
export {
  renderDeleteAccountEmail,
  type DeleteAccountEmailInput,
} from './templates/delete-account.tsx';
export {
  renderOrgInviteEmail,
  type OrgInviteEmailInput,
} from './templates/org-invite.tsx';
export {
  renderChannelTestEmail,
  type ChannelTestEmailInput,
} from './templates/channel-test.tsx';
export {
  renderPartnerClaimEmail,
  type PartnerClaimEmailInput,
} from './templates/partner-claim.tsx';

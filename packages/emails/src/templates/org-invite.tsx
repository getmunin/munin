import {
  BodyText,
  CTA,
  ExpiryText,
  Eyebrow,
  FallbackUrl,
  Heading,
  Shell,
} from '../components/Shell.tsx';
import { defaultEmailLocale, pickLocale, type EmailLocale } from '../locales/index.ts';
import { renderEmail, type RenderedEmail } from '../render.ts';

export interface OrgInviteEmailInput {
  acceptUrl: string;
  orgName: string;
  inviterName?: string | null;
  locale?: EmailLocale;
}

export async function renderOrgInviteEmail(input: OrgInviteEmailInput): Promise<RenderedEmail> {
  const locale = input.locale ?? defaultEmailLocale();
  const t = pickLocale(locale).orgInvite;
  const fb = pickLocale(locale).shared;
  const subject = t.subject(input.orgName);
  const heading = t.heading(input.orgName);
  const body = t.body(input.inviterName ?? null, input.orgName);
  const footerReason = t.footerReason(input.orgName);

  const element = (
    <Shell preview={heading} locale={locale} footerReason={footerReason}>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading>{heading}</Heading>
      <BodyText>{body}</BodyText>
      <CTA href={input.acceptUrl}>{t.cta}</CTA>
      <FallbackUrl url={input.acceptUrl} locale={locale} />
      <ExpiryText>{t.expiry}</ExpiryText>
    </Shell>
  );

  const plaintext = [
    body,
    '',
    `${t.cta}: ${input.acceptUrl}`,
    '',
    fb.fallbackPrefix,
    input.acceptUrl,
    '',
    t.expiry,
  ].join('\n');

  return renderEmail({ subject, element, plaintext });
}

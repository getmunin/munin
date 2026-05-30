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

export interface PartnerClaimEmailInput {
  claimUrl: string;
  partnerName: string;
  customerOrgName: string;
  recipientName?: string | null;
  locale?: EmailLocale;
}

export async function renderPartnerClaimEmail(
  input: PartnerClaimEmailInput,
): Promise<RenderedEmail> {
  const locale = input.locale ?? defaultEmailLocale();
  const t = pickLocale(locale).partnerClaim;
  const fb = pickLocale(locale).shared;
  const body = t.body(input.partnerName, input.customerOrgName);
  const expiry = t.expiry(input.partnerName);

  const element = (
    <Shell preview={t.heading} locale={locale} footerReason={t.footerReason}>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading>{t.heading}</Heading>
      <BodyText>{body}</BodyText>
      <CTA href={input.claimUrl}>{t.cta}</CTA>
      <FallbackUrl url={input.claimUrl} locale={locale} />
      <ExpiryText>{expiry}</ExpiryText>
    </Shell>
  );

  const plaintext = [
    body,
    '',
    `${t.cta}: ${input.claimUrl}`,
    '',
    fb.fallbackPrefix,
    input.claimUrl,
    '',
    expiry,
  ].join('\n');

  return renderEmail({ subject: t.subject, element, plaintext });
}

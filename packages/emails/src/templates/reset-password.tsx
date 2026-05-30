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

export interface ResetPasswordEmailInput {
  url: string;
  recipientName?: string | null;
  locale?: EmailLocale;
}

export async function renderResetPasswordEmail(
  input: ResetPasswordEmailInput,
): Promise<RenderedEmail> {
  const locale = input.locale ?? defaultEmailLocale();
  const t = pickLocale(locale).resetPassword;
  const fb = pickLocale(locale).shared;

  const element = (
    <Shell preview={t.heading} locale={locale} footerReason={t.footerReason}>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading>{t.heading}</Heading>
      <BodyText>{t.body(input.recipientName)}</BodyText>
      <CTA href={input.url}>{t.cta}</CTA>
      <FallbackUrl url={input.url} locale={locale} />
      <ExpiryText>{t.expiry}</ExpiryText>
    </Shell>
  );

  const plaintext = [
    t.body(input.recipientName),
    '',
    `${t.cta}: ${input.url}`,
    '',
    fb.fallbackPrefix,
    input.url,
    '',
    t.expiry,
  ].join('\n');

  return renderEmail({ subject: t.subject, element, plaintext });
}

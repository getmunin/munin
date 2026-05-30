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

export interface DeleteAccountEmailInput {
  url: string;
  locale?: EmailLocale;
}

export async function renderDeleteAccountEmail(
  input: DeleteAccountEmailInput,
): Promise<RenderedEmail> {
  const locale = input.locale ?? defaultEmailLocale();
  const t = pickLocale(locale).deleteAccount;
  const fb = pickLocale(locale).shared;

  const element = (
    <Shell preview={t.heading} locale={locale} footerReason={t.footerReason}>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading>{t.heading}</Heading>
      <BodyText>{t.body}</BodyText>
      <CTA href={input.url}>{t.cta}</CTA>
      <FallbackUrl url={input.url} locale={locale} />
      <ExpiryText>{t.expiry}</ExpiryText>
    </Shell>
  );

  const plaintext = [
    t.body,
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

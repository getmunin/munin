import {
  BodyText,
  DiagnosticTable,
  Eyebrow,
  Heading,
  Shell,
} from '../components/Shell.tsx';
import { defaultEmailLocale, pickLocale, type EmailLocale } from '../locales/index.ts';
import { renderEmail, type RenderedEmail } from '../render.ts';

export interface ChannelTestEmailInput {
  channelName: string;
  channelAddress: string;
  messageId?: string | null;
  deliveryNote?: string | null;
  locale?: EmailLocale;
}

export async function renderChannelTestEmail(
  input: ChannelTestEmailInput,
): Promise<RenderedEmail> {
  const locale = input.locale ?? defaultEmailLocale();
  const t = pickLocale(locale).channelTest;
  const subject = t.subject(input.channelName);
  const body = t.body(input.channelName);

  const rows = [
    { label: t.diagChannel, value: input.channelName },
    { label: t.diagAddress, value: input.channelAddress },
    { label: t.diagDelivery, value: input.deliveryNote ?? t.diagDelivered },
    ...(input.messageId ? [{ label: t.diagMessageId, value: `<${input.messageId}>` }] : []),
  ];

  const element = (
    <Shell preview={t.heading} locale={locale} footerReason={t.footerReason}>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading>{t.heading}</Heading>
      <BodyText>{body}</BodyText>
      <DiagnosticTable rows={rows} />
    </Shell>
  );

  const plaintext = [
    body,
    '',
    ...rows.map((r) => `${r.label}: ${typeof r.value === 'string' ? r.value : ''}`),
  ].join('\n');

  return renderEmail({ subject, element, plaintext });
}

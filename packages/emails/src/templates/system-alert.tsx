import {
  BodyText,
  CTA,
  DiagnosticTable,
  ExpiryText,
  Eyebrow,
  Heading,
  Shell,
} from '../components/Shell.tsx';
import { defaultEmailLocale, pickLocale, type EmailLocale } from '../locales/index.ts';
import { renderEmail, type RenderedEmail } from '../render.ts';

export type SystemAlertEmailSeverity = 'warning' | 'error';

export interface SystemAlertEmailInput {
  alertTitle: string;
  alertDetail?: string | null;
  severity: SystemAlertEmailSeverity;
  source: string;
  orgName: string;
  personal: boolean;
  ctaHref?: string | null;
  locale?: EmailLocale;
}

export async function renderSystemAlertEmail(
  input: SystemAlertEmailInput,
): Promise<RenderedEmail> {
  const locale = input.locale ?? defaultEmailLocale();
  const t = pickLocale(locale).systemAlert;

  const subject = t.subject(input.severity, input.alertTitle);
  const heading = input.alertTitle;
  const body = input.personal ? t.bodyPersonal(input.orgName) : t.bodyOrg(input.orgName);
  const rows = [
    { label: t.labelSeverity, value: t.severityName(input.severity) },
    { label: t.labelSource, value: input.source },
    ...(input.alertDetail ? [{ label: t.labelDetail, value: input.alertDetail }] : []),
  ];

  const element = (
    <Shell preview={heading} locale={locale} footerReason={t.footerReason(input.personal)}>
      <Eyebrow>{t.eyebrow}</Eyebrow>
      <Heading>{heading}</Heading>
      <BodyText>{body}</BodyText>
      <DiagnosticTable rows={rows} />
      {input.ctaHref ? <CTA href={input.ctaHref}>{t.cta}</CTA> : null}
      <ExpiryText>{t.resolveNote}</ExpiryText>
    </Shell>
  );

  const plaintext = [
    heading,
    '',
    body,
    '',
    ...rows.map((row) => `${row.label}: ${String(row.value)}`),
    ...(input.ctaHref ? ['', `${t.cta}: ${input.ctaHref}`] : []),
    '',
    t.resolveNote,
  ].join('\n');

  return renderEmail({ subject, element, plaintext });
}

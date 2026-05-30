import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import { colors, fonts, RAVEN_PNG_URL, sizes } from './tokens.ts';
import type { EmailLocale } from '../locales/index.ts';
import { pickLocale } from '../locales/index.ts';

export interface ShellProps {
  preview: string;
  locale: EmailLocale;
  footerReason: string;
  children: ReactNode;
  helpUrl?: string;
  privacyUrl?: string;
}

export function Shell({
  preview,
  locale,
  footerReason,
  helpUrl = 'https://getmunin.com/docs',
  privacyUrl = 'https://getmunin.com/privacy',
  children,
}: ShellProps) {
  const l = pickLocale(locale);

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.bone,
          fontFamily: fonts.sans,
          margin: 0,
          padding: '32px 0',
          color: colors.inkSoft,
        }}
      >
        <Container
          style={{
            maxWidth: sizes.bodyMax,
            margin: '0 auto',
            background: colors.paper,
            border: `1px solid ${colors.rule}`,
          }}
        >
          <Section style={{ padding: `${sizes.bodyPaddingY} ${sizes.bodyPaddingX} 24px` }}>
            <Img
              src={RAVEN_PNG_URL}
              alt="Munin"
              width="26"
              height="26"
              style={{ display: 'inline-block', verticalAlign: 'middle' }}
            />
            <span
              style={{
                fontFamily: fonts.serif,
                fontSize: '21px',
                letterSpacing: '-0.02em',
                color: colors.ink,
                marginLeft: '10px',
                verticalAlign: 'middle',
              }}
            >
              Munin
            </span>
          </Section>

          <Section style={{ padding: `0 ${sizes.bodyPaddingX} ${sizes.bodyPaddingY}` }}>
            {children}
          </Section>

          <Section
            style={{
              padding: `24px ${sizes.bodyPaddingX} 32px`,
              borderTop: `1px solid ${colors.rule}`,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: '10px',
                letterSpacing: '0.04em',
                color: colors.inkMute,
                lineHeight: 1.6,
                margin: '0 0 8px',
              }}
            >
              {footerReason}
            </Text>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: '10px',
                letterSpacing: '0.04em',
                color: colors.inkMute,
                lineHeight: 1.6,
                margin: '0 0 12px',
              }}
            >
              {l.shared.footerLegal}
            </Text>
            <Link
              href={helpUrl}
              style={{
                fontFamily: fonts.mono,
                fontSize: '10px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: colors.inkSoft,
                textDecoration: 'none',
                marginRight: '16px',
              }}
            >
              {l.shared.footerHelp}
            </Link>
            <Link
              href={privacyUrl}
              style={{
                fontFamily: fonts.mono,
                fontSize: '10px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: colors.inkSoft,
                textDecoration: 'none',
              }}
            >
              {l.shared.footerPrivacy}
            </Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export interface EyebrowProps {
  children: ReactNode;
}

export function Eyebrow({ children }: EyebrowProps) {
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: '10px',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: colors.accent,
        margin: '0 0 18px',
      }}
    >
      ─── {children}
    </Text>
  );
}

export interface HeadingProps {
  children: ReactNode;
}

export function Heading({ children }: HeadingProps) {
  return (
    <Text
      style={{
        fontFamily: fonts.serif,
        fontWeight: 400,
        fontSize: '32px',
        lineHeight: 1.06,
        letterSpacing: '-0.02em',
        color: colors.ink,
        margin: '0 0 24px',
      }}
    >
      {children}
    </Text>
  );
}

export interface BodyTextProps {
  children: ReactNode;
}

export function BodyText({ children }: BodyTextProps) {
  return (
    <Text
      style={{
        fontFamily: fonts.sans,
        fontSize: '15px',
        lineHeight: 1.65,
        color: colors.inkSoft,
        margin: '0 0 18px',
      }}
    >
      {children}
    </Text>
  );
}

export interface CTAProps {
  href: string;
  children: ReactNode;
}

export function CTA({ href, children }: CTAProps) {
  return (
    <Section style={{ margin: '10px 0 16px' }}>
      <Link
        href={href}
        style={{
          display: 'inline-block',
          fontFamily: fonts.mono,
          fontSize: '11px',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          textDecoration: 'none',
          padding: '15px 26px',
          background: colors.ink,
          color: colors.paper,
          border: `1px solid ${colors.ink}`,
        }}
      >
        {children} →
      </Link>
    </Section>
  );
}

export interface FallbackUrlProps {
  url: string;
  locale: EmailLocale;
}

export function FallbackUrl({ url, locale }: FallbackUrlProps) {
  const l = pickLocale(locale);
  return (
    <Section
      style={{
        margin: '24px 0 0',
        padding: '16px 18px',
        border: `1px solid ${colors.rule}`,
        background: colors.bone,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.inkMute,
          margin: '0 0 8px',
        }}
      >
        {l.shared.fallbackPrefix}
      </Text>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: '12px',
          color: colors.accentDeep,
          wordBreak: 'break-all',
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {url}
      </Text>
    </Section>
  );
}

export interface ExpiryNoteProps {
  children: ReactNode;
}

export function ExpiryNote({ children }: ExpiryNoteProps) {
  return (
    <Hr style={{ borderColor: colors.rule, margin: '24px 0 0' }}>
      <Text
        style={{
          paddingTop: '22px',
          fontFamily: fonts.sans,
          fontSize: '13px',
          lineHeight: 1.65,
          color: colors.inkMute,
          margin: 0,
        }}
      >
        {children}
      </Text>
    </Hr>
  );
}

export function ExpiryText({ children }: ExpiryNoteProps) {
  return (
    <Section style={{ borderTop: `1px solid ${colors.rule}`, marginTop: '24px', paddingTop: '22px' }}>
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: '13px',
          lineHeight: 1.65,
          color: colors.inkMute,
          margin: 0,
        }}
      >
        {children}
      </Text>
    </Section>
  );
}

export interface DiagnosticRow {
  label: string;
  value: ReactNode;
}

export interface DiagnosticTableProps {
  rows: DiagnosticRow[];
}

export function DiagnosticTable({ rows }: DiagnosticTableProps) {
  return (
    <Section
      style={{
        margin: '8px 0 0',
        border: `1px solid ${colors.rule}`,
      }}
    >
      {rows.map((row, i) => (
        <Section
          key={i}
          style={{
            padding: '11px 16px',
            borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${colors.rule}`,
          }}
        >
          <Text
            style={{
              display: 'inline-block',
              width: '120px',
              verticalAlign: 'baseline',
              fontFamily: fonts.mono,
              fontSize: '9px',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: colors.inkMute,
              margin: 0,
            }}
          >
            {row.label}
          </Text>
          <Text
            style={{
              display: 'inline-block',
              verticalAlign: 'baseline',
              fontFamily: fonts.mono,
              fontSize: '12px',
              color: colors.ink,
              wordBreak: 'break-all',
              margin: 0,
            }}
          >
            {row.value}
          </Text>
        </Section>
      ))}
    </Section>
  );
}

import Image from 'next/image';
import type { ReactNode } from 'react';
import { Eyebrow } from '@getmunin/ui';

export interface StandaloneNoticeProps {
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  footnote?: ReactNode;
  action?: ReactNode;
  logoSrc?: string;
}

export function StandaloneNotice({
  eyebrow,
  title,
  lede,
  footnote,
  action,
  logoSrc = '/munin-logo.png',
}: StandaloneNoticeProps) {
  return (
    <main className="min-h-dvh w-full bg-bone dark:bg-background">
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
        <Image src={logoSrc} alt="Munin" width={40} height={40} className="block" priority />
        <Eyebrow tone="muted">{eyebrow}</Eyebrow>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.05] font-normal tracking-tight text-ink dark:text-foreground">
          {title}
        </h1>
        <p className="max-w-xl text-base leading-[1.5] text-ink-soft dark:text-foreground/80">
          {lede}
        </p>
        {footnote ? (
          <p className="font-mono text-[11px] text-ink-soft dark:text-foreground/80">{footnote}</p>
        ) : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </main>
  );
}

export function noticeEmphasis(chunks: ReactNode): ReactNode {
  return <em className="font-serif italic text-cobalt dark:text-cobalt-soft">{chunks}</em>;
}

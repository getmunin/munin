'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';

export interface EmptyPerchProps {
  docsHref?: string;
  mcpHref?: string;
}

export function EmptyPerch({ docsHref = '/docs', mcpHref = '/docs' }: EmptyPerchProps) {
  const t = useTranslations('dashboard.inbox.empty');
  return (
    <section
      data-slot="empty-perch"
      data-screen-label="Inbox · empty"
      className="flex flex-col gap-6 py-16 text-ink dark:text-foreground"
    >
      <div className="flex items-center gap-2 font-mono uppercase tracking-eyebrow leading-none text-[11px] text-ink-mute dark:text-foreground/60">
        <span aria-hidden className="size-1.5 rounded-full bg-ink-mute dark:bg-foreground/50" />
        <span>{t('eyebrow')}</span>
      </div>

      <h1 className="font-serif text-ink dark:text-foreground text-[56px] leading-[1.05] tracking-[-0.02em] [&_em]:italic [&_em]:text-cobalt dark:[&_em]:text-cobalt-soft">
        {t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
      </h1>

      <p className="text-[15px] leading-relaxed text-ink-soft dark:text-foreground/75 max-w-[60ch]">
        {t('body')}
      </p>

      <div className="flex items-center gap-3">
        <Button variant="default" render={<Link href={docsHref} />}>
          {t('readDocs')}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Button>
        <Button variant="outline" render={<Link href={mcpHref} />}>
          {t('browseMcp')}
        </Button>
      </div>
    </section>
  );
}

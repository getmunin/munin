'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { Segmented } from '../channel-knowledge';

type PreviewView = 'desktop' | 'mobile' | 'text';

const VIEWS: readonly PreviewView[] = ['desktop', 'mobile', 'text'];

export function BroadcastEmailPreview({
  html,
  text,
  recipientName,
}: {
  html: string;
  text: string;
  recipientName: string | null;
}) {
  const t = useTranslations('dashboard.console.review.broadcast');
  const [view, setView] = useState<PreviewView>('desktop');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
          {recipientName ? t('previewFor', { name: recipientName }) : t('previewHeading')}
        </span>
        <Segmented<PreviewView>
          label={t('previewViewLabel')}
          options={VIEWS.map((v) => ({ value: v, label: t(`view.${v}`) }))}
          value={view}
          onChange={setView}
          className="ml-auto [&>button]:flex-none [&>button]:px-2.5 [&>button]:py-1 [&>button]:text-[12px]"
        />
      </div>
      <div className="flex justify-center overflow-x-auto border border-ink bg-paper-deep dark:border-rule-on-dark dark:bg-secondary">
        {view === 'text' ? (
          <pre className="min-h-[320px] w-full whitespace-pre-wrap break-words bg-paper px-5 py-4 font-sans text-[13.5px] leading-relaxed text-ink dark:bg-card dark:text-foreground">
            {text}
          </pre>
        ) : (
          <iframe
            title={t('previewTitle')}
            srcDoc={html}
            sandbox=""
            referrerPolicy="no-referrer"
            className={cn(
              'h-[640px] max-w-full border-0 bg-white',
              view === 'mobile' ? 'w-[375px]' : 'w-full',
            )}
          />
        )}
      </div>
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { useCopy } from '../../../lib/use-copy';
import { useRelative } from '../../../lib/use-relative';
import { PaneFooter, PaneHeader, useCmdEnter } from './shared';
import type { SocialDraftDto } from './types';

export function SocialQueuePane({
  item,
  pending,
  onApprove,
  onDismiss,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: SocialDraftDto };
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const bodyCopy = useCopy();
  const linkCopy = useCopy();

  useCmdEnter(() => {
    if (!pending) onApprove();
  });

  const draft = item.raw;
  const shareUrl = draft.shareUrl ?? draft.linkUrl;

  return (
    <>
      <PaneHeader
        kind="social"
        pillLabel={tQueue('kindSocial')}
        title={item.title}
        meta={t('metaSocial', {
          platform: draft.platform,
          chars: draft.bodyChars,
          max: draft.maxBodyChars,
          age: age(item.createdAt),
        })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-7">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
              {t('socialBody')}
            </p>
            <Button variant="outline" size="sm" onClick={() => bodyCopy.copy(draft.body)}>
              {bodyCopy.copied ? t('socialCopied') : t('socialCopyBody')}
            </Button>
          </div>
          <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:border-rule-on-dark dark:bg-card dark:text-foreground">
            <p className="whitespace-pre-wrap">{draft.body}</p>
          </div>
        </section>

        {shareUrl && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                {t('socialLink')}
              </p>
              <Button variant="outline" size="sm" onClick={() => linkCopy.copy(shareUrl)}>
                {linkCopy.copied ? t('socialCopied') : t('socialCopyLink')}
              </Button>
            </div>
            <p className="break-all font-mono text-xs text-ink-mute">{shareUrl}</p>
            <p className="text-xs text-ink-mute">{t('socialLinkTagged')}</p>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs text-ink-mute">{t('socialComposerHint')}</p>
          <a
            href={draft.composerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt underline dark:text-cobalt-soft"
          >
            {t('socialOpenComposer', { platform: draft.platform })}
          </a>
        </section>
      </div>

      <PaneFooter
        primary={{ label: t('socialMarkPosted'), onClick: onApprove, disabled: pending }}
        secondary={[{ label: t('dismiss'), onClick: onDismiss, disabled: pending }]}
        shortcut={t('shortcutMarkPosted')}
      />
    </>
  );
}

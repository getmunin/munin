'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import { useCopy } from '../../../lib/use-copy';
import { useRelative } from '../../../lib/use-relative';
import { useSocialPublishTarget } from '../../../lib/use-publish-target';
import { PaneFooter, PaneHeader, useCmdEnter } from './shared';
import { socialPublishAvailability } from './social-actions';
import type { SocialDraftDto } from './types';

function guessMediaKind(url: string): 'image' | 'video' {
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url) ? 'video' : 'image';
}

export function SocialQueuePane({
  item,
  pending,
  onApprove,
  onPublish,
  onDismiss,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: SocialDraftDto };
  pending: boolean;
  onApprove: () => void;
  onPublish?: () => void;
  onDismiss: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const bodyCopy = useCopy();
  const linkCopy = useCopy();

  const draft = item.raw;
  const shareUrl = draft.shareUrl ?? draft.linkUrl;
  const linkInComment = draft.linkPlacement === 'comment';
  const mediaKind = draft.mediaKind ?? (draft.mediaUrl ? guessMediaKind(draft.mediaUrl) : null);
  const target = useSocialPublishTarget(draft.canPublish);
  const availability = socialPublishAvailability(draft, target);
  const canPublishNow = availability.state === 'ready' && onPublish !== undefined;

  useCmdEnter(() => {
    if (pending) return;
    if (availability.state === 'ready' && onPublish) onPublish();
    else if (availability.state === 'unsupported') onApprove();
  });

  const publishLabel =
    availability.state === 'ready' && availability.authorName
      ? t('socialPublishAs', { name: availability.authorName })
      : t('socialPublish');

  return (
    <>
      <PaneHeader
        kind="social"
        pillLabel={tQueue('kindSocial')}
        title={item.title}
        meta={
          draft.variantLabel && draft.variantLabel !== 'single'
            ? t('metaSocialAngle', {
                platform: draft.platform,
                angle: draft.variantLabel,
                chars: draft.bodyChars,
                max: draft.maxBodyChars,
                age: age(item.createdAt),
              })
            : t('metaSocial', {
                platform: draft.platform,
                chars: draft.bodyChars,
                max: draft.maxBodyChars,
                age: age(item.createdAt),
              })
        }
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

        {draft.mediaUrl && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
              {t('socialMedia')}
            </p>
            <div className="border-[1px] border-ink bg-paper p-2 dark:border-rule-on-dark dark:bg-card">
              {mediaKind === 'video' ? (
                <video controls preload="metadata" className="max-h-80 w-full" src={draft.mediaUrl}>
                  {t('socialMediaVideoUnsupported')}
                </video>
              ) : (
                <img
                  src={draft.mediaUrl}
                  alt={draft.mediaAltText ?? ''}
                  className="max-h-80 w-full object-contain"
                />
              )}
            </div>
            {draft.mediaAltText && <p className="text-xs text-ink-mute">{draft.mediaAltText}</p>}
          </section>
        )}

        {!draft.mediaUrl && shareUrl && (
          <p className="text-xs text-ink-mute">{t('socialMediaFromLink')}</p>
        )}

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
            {linkInComment && <p className="text-xs text-ink-mute">{t('socialLinkInComment')}</p>}
          </section>
        )}

        {linkInComment && draft.linkCommentText && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
              {t('socialLinkComment')}
            </p>
            <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:border-rule-on-dark dark:bg-card dark:text-foreground">
              <p className="whitespace-pre-wrap">{draft.linkCommentText}</p>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs text-ink-mute">
            {availability.state === 'ready'
              ? t('socialPublishHint', { platform: draft.platform })
              : availability.state === 'needsAccount'
                ? t('socialNeedsAccountHint', { platform: draft.platform })
                : t('socialComposerHint')}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {availability.state === 'needsAccount' && (
              <a
                href="/dashboard/settings/integrations"
                className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt underline dark:text-cobalt-soft"
              >
                {t('socialConnectAccount')}
              </a>
            )}
            <a
              href={draft.composerUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt underline dark:text-cobalt-soft"
            >
              {t('socialOpenComposer', { platform: draft.platform })}
            </a>
          </div>
        </section>
      </div>

      {availability.state === 'unsupported' || onPublish === undefined ? (
        <PaneFooter
          primary={{ label: t('socialMarkPosted'), onClick: onApprove, disabled: pending }}
          secondary={[{ label: t('dismiss'), onClick: onDismiss, disabled: pending }]}
          shortcut={t('shortcutMarkPosted')}
        />
      ) : (
        <PaneFooter
          primary={{
            label: publishLabel,
            onClick: onPublish,
            disabled: pending || availability.state !== 'ready',
          }}
          secondary={[
            { label: t('socialMarkPosted'), onClick: onApprove, disabled: pending },
            { label: t('dismiss'), onClick: onDismiss, disabled: pending },
          ]}
          shortcut={canPublishNow ? t('shortcutPublish') : undefined}
        />
      )}
    </>
  );
}

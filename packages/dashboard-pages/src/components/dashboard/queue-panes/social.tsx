'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@getmunin/ui';
import { useActiveMembership } from '../../../auth/use-active-role';
import { useCopy } from '../../../lib/use-copy';
import { useRelative } from '../../../lib/use-relative';
import { useSocialPublishTargets } from '../../../lib/use-publish-target';
import { PaneFooter, PaneHeader, useCmdEnter, ViewTab, ViewTabRow } from './shared';
import type { QueueActionError } from '../inbox-types';
import { shortPublishName, socialMediaKind, socialPublishAvailability } from './social-actions';
import { SocialPostPreview } from './social-post-preview';
import type { SocialDraftDto } from './types';

export function SocialQueuePane({
  item,
  pending,
  onApprove,
  onPublish,
  onDismiss,
  onClose,
  actionError,
  onClearActionError,
}: {
  item: { id: string; title: string; createdAt: string; raw: SocialDraftDto };
  pending: boolean;
  onApprove: () => void;
  onPublish?: () => void;
  onDismiss: () => void;
  onClose?: () => void;
  actionError?: QueueActionError;
  onClearActionError?: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const bodyCopy = useCopy();
  const linkCopy = useCopy();
  const { membership } = useActiveMembership();
  const [view, setView] = useState<'preview' | 'text'>('preview');

  useEffect(() => setView('preview'), [item.id]);

  const draft = item.raw;
  const shareUrl = draft.shareUrl ?? draft.linkUrl;
  const linkInComment = draft.linkPlacement === 'comment';
  const mediaKind = socialMediaKind(draft);
  const targets = useSocialPublishTargets(draft.canPublish);
  const availability = socialPublishAvailability(draft, targets);
  const canPublishNow = availability.state === 'ready' && onPublish !== undefined;

  useCmdEnter(() => {
    if (pending) return;
    if (availability.state === 'ready' && onPublish) onPublish();
    else if (availability.state === 'unsupported') onApprove();
  });

  const authorName =
    availability.state === 'ready'
      ? shortPublishName(availability.authorName, availability.authorKind)
      : null;
  const asPage = availability.state === 'ready' && availability.authorKind === 'org_page';
  const previewAuthor =
    (availability.state === 'ready' ? availability.authorName : null) ?? membership?.name ?? null;
  const previewAuthorKind = availability.state === 'ready' ? availability.authorKind : null;
  const paneError = actionError?.itemId === item.id ? actionError : null;
  const publishLabel = authorName
    ? t('socialPublishAs', { name: authorName })
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

      <ViewTabRow>
        <ViewTab active={view === 'preview'} onSelect={() => setView('preview')}>
          {t('socialViewPreview')}
        </ViewTab>
        <ViewTab active={view === 'text'} onSelect={() => setView('text')}>
          {t('socialViewText')}
        </ViewTab>
      </ViewTabRow>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-7">
        {view === 'preview' ? (
          <SocialPostPreview
              draft={draft}
              authorName={previewAuthor}
              authorKind={previewAuthorKind}
            />
        ) : (
          <>
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
                <Input
                  readOnly
                  value={shareUrl}
                  aria-label={t('socialLink')}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-auto border-ink px-4 py-3 font-mono text-xs dark:border-rule-on-dark"
                />
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
          </>
        )}

        {availability.state !== 'needsAccount' ? (
          <p className="text-xs text-ink-mute">
            {availability.state === 'ready'
              ? asPage
                ? t('socialPublishHintPage', {
                    platform: draft.platform,
                    name: availability.authorName ?? draft.platform,
                  })
                : t('socialPublishHint', { platform: draft.platform })
              : t('socialComposerHint')}
          </p>
        ) : null}
      </div>

      {availability.state === 'unsupported' || onPublish === undefined ? (
        <PaneFooter
          primary={{ label: t('socialMarkPosted'), onClick: onApprove, disabled: pending }}
          secondary={[{ label: t('dismiss'), onClick: onDismiss, disabled: pending }]}
          shortcut={t('shortcutMarkPosted')}
          error={paneError}
          onClearError={onClearActionError}
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
          error={paneError}
          onClearError={onClearActionError}
        />
      )}
    </>
  );
}

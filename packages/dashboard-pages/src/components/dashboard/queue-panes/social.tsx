'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, cn } from '@getmunin/ui';
import { useActiveMembership } from '../../../auth/use-active-role';
import { useCopy } from '../../../lib/use-copy';
import { useRelative } from '../../../lib/use-relative';
import { useSocialPublishTargets } from '../../../lib/use-publish-target';
import { PaneFooter, PaneHeader, useCmdEnter, ViewTab, ViewTabRow } from './shared';
import type { QueueActionError } from '../inbox-types';
import { shortPublishName, socialMediaKind, socialPublishAvailability } from './social-actions';
import { SocialPostPreview } from './social-post-preview';
import { countBodyChars } from './social-preview';
import type { SocialDraftDto, SocialDraftEdit } from './types';

export function SocialQueuePane({
  item,
  pending,
  onApprove,
  onPublish,
  onDismiss,
  onSave,
  onClose,
  actionError,
  onClearActionError,
}: {
  item: { id: string; title: string; createdAt: string; raw: SocialDraftDto };
  pending: boolean;
  onApprove: () => void;
  onPublish?: () => void;
  onDismiss: () => void;
  onSave: (edit: SocialDraftEdit) => Promise<void>;
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

  const stored = item.raw;
  const storedComment = stored.linkCommentText ?? '';
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(stored.body);
  const [editedComment, setEditedComment] = useState(storedComment);

  useEffect(() => setView('preview'), [item.id]);

  useEffect(() => {
    setEditing(false);
    setEditedBody(stored.body);
    setEditedComment(storedComment);
  }, [item.id, stored.body, storedComment]);

  const linkInComment = stored.linkPlacement === 'comment';
  const trimmedComment = editedComment.trim();
  const draft = useMemo<SocialDraftDto>(
    () => ({
      ...stored,
      body: editedBody,
      linkCommentText: linkInComment ? trimmedComment || null : stored.linkCommentText,
    }),
    [stored, editedBody, linkInComment, trimmedComment],
  );

  const shareUrl = draft.shareUrl ?? draft.linkUrl;
  const mediaKind = socialMediaKind(draft);
  const targets = useSocialPublishTargets(draft.canPublish);
  const availability = socialPublishAvailability(draft, targets);
  const canPublishNow = availability.state === 'ready' && onPublish !== undefined;

  const bodyChars = countBodyChars(draft.platform, editedBody);
  const overBy = Math.max(0, bodyChars - stored.maxBodyChars);
  const dirty =
    editedBody !== stored.body || (linkInComment && trimmedComment !== storedComment.trim());
  const canSave = !pending && dirty && editedBody.trim().length > 0 && overBy === 0;

  const startEdit = useCallback(() => {
    setView('text');
    setEditing(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedBody(stored.body);
    setEditedComment(storedComment);
  }, [stored.body, storedComment]);

  const saveEdit = useCallback(async () => {
    if (!canSave) return;
    const edit: SocialDraftEdit = {};
    if (editedBody !== stored.body) edit.body = editedBody;
    if (linkInComment && trimmedComment !== storedComment.trim()) {
      edit.linkCommentText = trimmedComment || null;
    }
    try {
      await onSave(edit);
    } catch {
      return;
    }
    setEditing(false);
  }, [canSave, editedBody, stored.body, linkInComment, trimmedComment, storedComment, onSave]);

  useCmdEnter(() => {
    if (pending) return;
    if (editing) {
      void saveEdit();
      return;
    }
    if (availability.state === 'ready' && onPublish) onPublish();
    else if (availability.state === 'unsupported') onApprove();
  });

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, cancelEdit]);

  const authorName =
    availability.state === 'ready'
      ? shortPublishName(availability.authorName, availability.authorKind)
      : null;
  const asPage = availability.state === 'ready' && availability.authorKind === 'org_page';
  const previewAuthor =
    (availability.state === 'ready' ? availability.authorName : null) ?? membership?.name ?? null;
  const previewAuthorKind = availability.state === 'ready' ? availability.authorKind : null;
  const paneError = actionError?.itemId === item.id ? actionError : null;
  const publishLabel = paneError
    ? t('socialRetryPublish')
    : authorName
      ? t('socialPublishAs', { name: authorName })
      : t('socialPublish');
  const editAction = { label: t('edit'), onClick: startEdit, disabled: pending };

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
                chars: bodyChars,
                max: draft.maxBodyChars,
                age: age(item.createdAt),
              })
            : t('metaSocial', {
                platform: draft.platform,
                chars: bodyChars,
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
              <div className="flex items-end justify-between gap-3">
                <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                  {t('socialBody')}
                </p>
                {editing ? (
                  <p
                    className={cn(
                      'font-mono text-[10px] font-medium uppercase tracking-eyebrow',
                      overBy > 0 ? 'text-destructive' : 'text-ink-mute',
                    )}
                  >
                    {overBy > 0
                      ? t('socialBodyOver', { over: overBy })
                      : t('socialBodyCount', { chars: bodyChars, max: draft.maxBodyChars })}
                  </p>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => bodyCopy.copy(draft.body)}>
                    {bodyCopy.copied ? t('socialCopied') : t('socialCopyBody')}
                  </Button>
                )}
              </div>
              {editing ? (
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={12}
                  aria-label={t('socialBody')}
                  className="w-full resize-y rounded-input border-[1px] border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
                  autoFocus
                />
              ) : (
                <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:border-rule-on-dark dark:bg-card dark:text-foreground">
                  <p className="whitespace-pre-wrap">{draft.body}</p>
                </div>
              )}
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
                <div className="flex items-end justify-between gap-3">
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

            {linkInComment && (editing || draft.linkCommentText) && (
              <section className="space-y-2">
                <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                  {t('socialLinkComment')}
                </p>
                {editing ? (
                  <textarea
                    value={editedComment}
                    onChange={(e) => setEditedComment(e.target.value)}
                    rows={3}
                    aria-label={t('socialLinkComment')}
                    placeholder={t('socialLinkCommentPlaceholder')}
                    className="w-full resize-y rounded-input border-[1px] border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
                  />
                ) : (
                  <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:border-rule-on-dark dark:bg-card dark:text-foreground">
                    <p className="whitespace-pre-wrap">{draft.linkCommentText}</p>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {!editing && availability.state !== 'needsAccount' ? (
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

      {editing ? (
        <PaneFooter
          primary={{ label: t('save'), onClick: () => void saveEdit(), disabled: !canSave }}
          secondary={[
            { label: t('cancel'), onClick: cancelEdit, disabled: pending, variant: 'ghost' },
          ]}
          shortcut={t('shortcutSave')}
          error={paneError}
          onClearError={onClearActionError}
        />
      ) : availability.state === 'unsupported' || onPublish === undefined ? (
        <PaneFooter
          primary={{
            label: t('socialMarkPosted'),
            onClick: onApprove,
            disabled: pending,
            arrow: true,
          }}
          secondary={[
            editAction,
            { label: t('dismiss'), onClick: onDismiss, disabled: pending, variant: 'ghost' },
          ]}
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
            arrow: true,
          }}
          secondary={[
            editAction,
            { label: t('socialMarkPosted'), onClick: onApprove, disabled: pending },
            { label: t('dismiss'), onClick: onDismiss, disabled: pending, variant: 'ghost' },
          ]}
          shortcut={canPublishNow ? t('shortcutPublish') : undefined}
          error={paneError}
          onClearError={onClearActionError}
        />
      )}
    </>
  );
}

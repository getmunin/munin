'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BodyDiff } from '@getmunin/ui';
import { useRelative } from '../../../lib/use-relative';
import {
  DrawerFooter,
  DrawerHeader,
  DrawerLoadFailed,
  DrawerLoadingState,
  Markdown,
  useCmdEnter,
} from './shared';
import type { KbCandidateDto } from './types';

export function KbQueueDrawer({
  item,
  body,
  revisedBody,
  loadError,
  onRetry,
  pending,
  onApprove,
  onDismiss,
  onSave,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: KbCandidateDto };
  body: string | undefined;
  revisedBody?: string;
  loadError: string | undefined;
  onRetry: () => void;
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onClose?: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const tCommon = useTranslations('common');
  const age = useRelative();
  const initialBody = body ?? '';
  const blocked = pending || body === undefined;
  const loadFailed = body === undefined && loadError !== undefined;
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(initialBody);
  const isRevision = item.raw.revisesDocumentId !== null;

  useEffect(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [item.id, initialBody]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [initialBody]);

  const saveEdit = async () => {
    if (!editedBody.trim() || pending) return;
    await onSave(editedBody);
    setEditing(false);
  };

  useCmdEnter(() => {
    if (editing) {
      if (!pending) void saveEdit();
      return;
    }
    if (!blocked) onApprove();
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

  return (
    <>
      <DrawerHeader
        pillTone="kb"
        pillLabel={isRevision ? tQueue('kindKbRevision') : tQueue('kindKb')}
        pillGlyph="kb"
        title={item.title}
        meta={
          isRevision
            ? t('metaKbRevision', {
                title: item.raw.revisesDocumentTitle ?? item.title,
                version: item.raw.revisesDocumentVersion ?? 0,
                age: age(item.createdAt),
              })
            : t('metaKb', {
                slug: item.raw.proposedTargetSpaceSlug ?? t('kbSlugFallback'),
                age: age(item.createdAt),
              })
        }
        onClose={onClose}
        closeLabel={t('close')}
      />

      {body !== undefined ? (
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {isRevision ? t('proposalRevision') : t('proposal')}
            </p>
            {editing ? (
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={14}
                className="w-full resize-y rounded-input border-[1px] border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
                autoFocus
              />
            ) : isRevision && revisedBody !== undefined ? (
              <BodyDiff
                before={revisedBody}
                after={editedBody}
                unchangedLabel={t('kbRevisionNoChange')}
              />
            ) : (
              <div className="border-[1px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
                <Markdown>{editedBody}</Markdown>
              </div>
            )}
          </section>
        </div>
      ) : loadError !== undefined ? (
        <DrawerLoadFailed
          eyebrow={t('loadFailedEyebrow')}
          title={t('detailLoadFailed')}
          reason={loadError}
          retryLabel={tCommon('retry')}
          retryingLabel={tCommon('retrying')}
          onRetry={onRetry}
        />
      ) : (
        <DrawerLoadingState label={t('loading')} />
      )}

      {editing ? (
        <DrawerFooter
          primary={{
            label: t('save'),
            onClick: () => void saveEdit(),
            disabled: pending || !editedBody.trim(),
          }}
          secondary={[{ label: t('cancel'), onClick: cancelEdit }]}
          shortcut={t('shortcutSave')}
        />
      ) : loadFailed ? null : (
        <>
          <p className="px-6 pb-2 text-xs leading-relaxed text-ink-mute">
            {isRevision ? t('kbRevisionPublishNote') : t('kbDismissPermanent')}
          </p>
          <DrawerFooter
            primary={{
              label: isRevision ? t('kbRevisionApprove') : t('approve'),
              onClick: onApprove,
              disabled: blocked,
            }}
            secondary={[
              { label: t('edit'), onClick: () => setEditing(true), disabled: blocked },
              { label: t('dismiss'), onClick: onDismiss, disabled: blocked },
            ]}
            shortcut={t('shortcutApprove')}
          />
        </>
      )}
    </>
  );
}

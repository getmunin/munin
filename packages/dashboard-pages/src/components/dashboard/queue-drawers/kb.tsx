'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRelative } from '../../../lib/use-relative';
import {
  DrawerErrorState,
  DrawerFooter,
  DrawerHeader,
  DrawerLoadingState,
  Markdown,
  useCmdEnter,
} from './shared';
import type { KbCandidateDto } from './types';

export function KbQueueDrawer({
  item,
  body,
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
  loadError: string | undefined;
  onRetry: () => void;
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const initialBody = body ?? '';
  const blocked = pending || body === undefined;
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(initialBody);

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
        pillLabel={tQueue('kindKb')}
        title={item.title}
        meta={t('metaKb', {
          slug: item.raw.proposedTargetSpaceSlug ?? t('kbSlugFallback'),
          age: age(item.createdAt),
        })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      {body !== undefined ? (
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('proposal')}
            </p>
            {editing ? (
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={14}
                className="w-full resize-y rounded-input border-[0.5px] border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
                autoFocus
              />
            ) : (
              <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
                <Markdown>{editedBody}</Markdown>
              </div>
            )}
          </section>
        </div>
      ) : loadError ? (
        <DrawerErrorState
          message={t('detailLoadFailed')}
          retryLabel={t('retry')}
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
      ) : (
        <DrawerFooter
          primary={{ label: t('approve'), onClick: onApprove, disabled: blocked }}
          secondary={[
            { label: t('edit'), onClick: () => setEditing(true), disabled: blocked },
            { label: t('dismiss'), onClick: onDismiss, disabled: blocked },
          ]}
          shortcut={t('shortcutApprove')}
        />
      )}
    </>
  );
}

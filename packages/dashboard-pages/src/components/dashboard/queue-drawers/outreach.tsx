'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRelative } from '../../../lib/use-relative';
import { DrawerFooter, DrawerHeader, Markdown, useCmdEnter } from './shared';
import type { OutreachProposalDto } from './types';

export function OutreachQueueDrawer({
  item,
  pending,
  onApprove,
  onDismiss,
  onSave,
  onClose,
}: {
  item: { id: string; title: string; snippet: string; createdAt: string; raw: OutreachProposalDto };
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const initialBody = item.raw.draftBody;
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
    if (pending) return;
    if (editing) void saveEdit();
    else onApprove();
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

  const kind =
    item.raw.kind === 'reply'
      ? t('outreachKindReply')
      : item.raw.kind === 'followup'
        ? t('outreachKindFollowup', { step: item.raw.sequenceStep ?? 1 })
        : t('outreachKindInitial');
  const handle = item.raw.contact?.email ?? item.raw.campaign?.name ?? t('handleFallback');

  return (
    <>
      <DrawerHeader
        pillTone="out"
        pillLabel={tQueue('kindOutreach')}
        title={item.title}
        meta={t('metaOutreach', { kind, handle, age: age(item.createdAt) })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {item.raw.kind === 'reply' && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('replyFrom')}
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{item.snippet}&rdquo;
            </p>
          </section>
        )}

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
              {item.raw.draftSubject && (
                <p className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                  {t('subject', { subject: item.raw.draftSubject })}
                </p>
              )}
              <Markdown>{editedBody}</Markdown>
            </div>
          )}
        </section>
      </div>

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
          primary={{ label: t('approve'), onClick: onApprove, disabled: pending }}
          secondary={[
            { label: t('edit'), onClick: () => setEditing(true), disabled: pending },
            { label: t('dismiss'), onClick: onDismiss, disabled: pending },
          ]}
          shortcut={t('shortcutApprove')}
        />
      )}
    </>
  );
}

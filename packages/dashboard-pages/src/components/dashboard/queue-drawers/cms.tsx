'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { MoreHorizontal } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { useRelative } from '../../../lib/use-relative';
import { DrawerFooter, DrawerHeader, MD_COMPONENTS, useCmdEnter } from './shared';
import {
  readBodyFromCmsData,
  readCoverImage,
  readStringField,
  type CmsDraftDetailDto,
  type CmsDraftSummaryDto,
} from './types';

export function CmsQueueDrawer({
  item,
  detail,
  pending,
  onApprove,
  onDismiss,
  onSave,
  onSchedule,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: CmsDraftSummaryDto };
  detail: CmsDraftDetailDto | undefined;
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onSchedule: (scheduledAt: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const initialBody = readBodyFromCmsData(detail?.data);
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(initialBody);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);

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

  const openScheduler = () => {
    if (!scheduledAt) setScheduledAt(tomorrowLocal());
    setScheduleError(null);
    setSchedulerOpen(true);
  };

  const submitSchedule = async () => {
    if (!scheduledAt) return;
    const at = new Date(scheduledAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      setScheduleError(t('cmsScheduleError'));
      return;
    }
    setScheduleError(null);
    try {
      await onSchedule(at.toISOString());
      setSchedulerOpen(false);
      setScheduledAt('');
    } catch {
      /* notify already surfaced upstream */
    }
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

  const cover = readCoverImage(detail?.data);
  const caption = readStringField(detail?.data, 'cover_caption');

  return (
    <>
      <DrawerHeader
        pillTone="cms"
        pillLabel={tQueue('kindCms')}
        title={item.title}
        meta={t('metaCms', {
          collection: item.raw.collectionName,
          age: age(item.createdAt),
        })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('cmsCoverImage')}
          </p>
          {cover ? (
            <figure className="border-[0.5px] border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-card">
              <div className="relative aspect-[16/9] w-full overflow-hidden">
                <img
                  src={cover.publicUrl}
                  alt={cover.altText ?? ''}
                  className="size-full object-cover"
                />
                <span className="absolute right-2 bottom-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute bg-paper/85 px-1.5 py-0.5 dark:bg-card/85">
                  {t('cmsCoverAspect')}
                </span>
              </div>
              {caption && (
                <figcaption className="border-t-[0.5px] border-rule-soft px-3 py-2 font-serif italic text-sm text-ink-mute dark:border-rule-on-dark">
                  {caption}
                </figcaption>
              )}
            </figure>
          ) : (
            <div className="relative flex aspect-[16/9] w-full items-center justify-center border-[0.5px] border-dashed border-rule-soft bg-paper-deep text-center text-sm text-ink-mute dark:border-rule-on-dark dark:bg-secondary">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow">
                {t('cmsCoverEmpty')}
              </span>
              <span className="absolute right-2 bottom-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {t('cmsCoverAspect')}
              </span>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('cmsBody')}
          </p>
          {editing ? (
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={18}
              placeholder={t('cmsBodyPlaceholder')}
              className="w-full resize-y rounded-input border-[0.5px] border-cobalt bg-paper px-4 py-3 font-sans text-[15px] leading-7 outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
              autoFocus
            />
          ) : detail ? (
            <div className="border-[0.5px] border-ink bg-paper px-4 py-3 font-sans text-[15px] leading-7 dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              <ReactMarkdown components={MD_COMPONENTS}>{editedBody}</ReactMarkdown>
            </div>
          ) : (
            <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed text-ink-mute italic dark:bg-card dark:border-rule-on-dark">
              {t('loading')}
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
        <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
          <Dialog
            open={schedulerOpen}
            onOpenChange={(o) => {
              setSchedulerOpen(o);
              if (!o) setScheduleError(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('cmsScheduleTitle')}</DialogTitle>
                <DialogDescription>{t('cmsScheduleDescription')}</DialogDescription>
              </DialogHeader>
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSchedule();
                }}
              >
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                    {t('cmsScheduleLabel')}
                  </span>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => {
                      setScheduledAt(e.target.value);
                      if (scheduleError) setScheduleError(null);
                    }}
                    className="rounded-input border-[0.5px] border-rule-soft bg-paper px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
                    autoFocus
                  />
                </label>
                {scheduleError && (
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-destructive">
                    {scheduleError}
                  </span>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSchedulerOpen(false)}
                  >
                    {t('cmsScheduleCancel')}
                  </Button>
                  <Button
                    type="submit"
                    variant="accent"
                    disabled={pending || !scheduledAt}
                  >
                    {t('cmsScheduleConfirm')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <div className="flex items-center justify-between gap-2 px-6 py-3">
            <div className="flex items-center gap-2">
              <Button variant="accent" size="sm" onClick={onApprove} disabled={pending}>
                {t('cmsApprove')}
              </Button>
              <Button variant="outline" size="sm" onClick={onDismiss} disabled={pending}>
                {t('cmsDismiss')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t('cmsMoreMenu')}
                      disabled={pending}
                    />
                  }
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    disabled={pending || !detail}
                    onClick={() => setEditing(true)}
                  >
                    {t('edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={pending} onClick={openScheduler}>
                    {t('cmsSchedule')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('shortcutCmsApprove')}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function tomorrowLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setSeconds(0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


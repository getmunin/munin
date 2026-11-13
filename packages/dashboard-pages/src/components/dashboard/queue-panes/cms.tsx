'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../../../api';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Pill,
} from '@getmunin/ui';
import { useRelative } from '../../../lib/use-relative';
import {
  PaneFooter,
  PaneHeader,
  PaneLoadFailed,
  PaneLoadingState,
  Markdown,
  PreviewStage,
  ScheduledFooter,
  ScheduledNotice,
  useCmdEnter,
  ViewTab,
  ViewTabRow,
} from './shared';
import { NativeSelect } from '../../native-select';
import type { PaneAction } from '../pane-more-actions';
import type { QueueActionError } from '../inbox-types';
import { computePatch, defaultForField, seedBlock } from './cms-blocks';
import { MetaArrow } from '../meta-arrow';
import { PaneNotice } from '../pane-notice';
import {
  asBlock,
  blockTypeDef,
  blockTypeLabel,
  humanizeFieldName,
  readAssetField,
  type CmsAssetExpanded,
  type CmsBlockTypeDef,
  type CmsDraftDetailDto,
  type CmsDraftSummaryDto,
  type CmsEntryStatus,
  type CmsPreviewLink,
  type CmsFieldDef,
  type CmsRefExpanded,
} from './types';

type EditableData = Record<string, unknown>;

export interface CmsPaneGroup {
  translations: Array<{ id: string; locale: string; status: CmsEntryStatus }>;
  yoursId: string | null;
  openPending: boolean;
  waitingLocales: string[];
  reference: {
    locale: string;
    yours: boolean;
    detail: CmsDraftDetailDto | undefined;
    loadError: string | undefined;
  } | null;
  onOpen: (id: string) => void;
  onApproveAll: () => void;
  onDismissAll: () => void;
  onScheduleAll: (scheduledAt: string) => Promise<void>;
}

export function CmsQueuePane({
  item,
  detail,
  loadError,
  onRetry,
  pending,
  readOnly = false,
  scheduledAt: scheduledPublishAt,
  onApprove,
  onDismiss,
  onSaveData,
  onUploadAsset,
  onSchedule,
  onCancelScheduled,
  previewLink,
  onRetryPreview,
  hideHeaderOnMobile,
  onClose,
  actionError,
  onClearActionError,
  group,
}: {
  item: { id: string; title: string; createdAt: string; raw: CmsDraftSummaryDto };
  detail: CmsDraftDetailDto | undefined;
  loadError: string | undefined;
  onRetry: () => void;
  pending: boolean;
  readOnly?: boolean;
  scheduledAt?: string;
  onApprove: () => void;
  onDismiss: () => void;
  onSaveData: (data: EditableData) => Promise<void>;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  onSchedule: (scheduledAt: string) => Promise<void>;
  onCancelScheduled?: () => void;
  previewLink?: CmsPreviewLink;
  onRetryPreview?: () => void;
  hideHeaderOnMobile?: boolean;
  onClose?: () => void;
  actionError?: QueueActionError;
  onClearActionError?: () => void;
  group?: CmsPaneGroup;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const paneError = actionError?.itemId === item.id ? actionError : null;
  const tQueue = useTranslations('dashboard.overview.queue');
  const tCommon = useTranslations('common');
  const age = useRelative();
  const format = useFormatter();

  const fields = detail?.fields ?? EMPTY_FIELDS;
  const initialData: EditableData = detail?.data ?? EMPTY_DATA;
  const blocked = pending || !detail;
  const loadFailed = !detail && loadError !== undefined;

  const [editing, setEditing] = useState(false);
  const [editedData, setEditedData] = useState<EditableData>(initialData);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(EMPTY_FIELD_ERRORS);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [view, setView] = useState<'preview' | 'read' | 'compare'>('preview');
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'failed'>('loading');

  const previewUrl = previewLink?.url ?? null;
  const blockedEmbed =
    previewLink?.embed && !previewLink.embed.embeddable ? previewLink.embed : null;
  const embedUrl = previewUrl && !blockedEmbed ? withEmbedParam(previewUrl) : null;
  const hasPreviewUrl = !!previewUrl && !editing;
  const showPreviewTab = hasPreviewUrl && !blockedEmbed;
  const reference = group?.reference ?? null;
  const canCompare = reference !== null && !editing;
  const activeView = view === 'compare' && !canCompare ? 'preview' : view;
  const waitingLocales = group?.waitingLocales ?? [];
  const manyWaiting = waitingLocales.length > 1;
  const openLocale = (detail?.locale ?? item.raw.locale).toUpperCase();
  const openStatus = group?.translations.find((tr) => tr.id === item.id)?.status ?? 'draft';

  useEffect(() => {
    setView((current) => (current === 'compare' ? current : 'preview'));
    setPreviewState('loading');
  }, [item.id, previewUrl]);

  useEffect(() => {
    if (!embedUrl || previewState !== 'loading') return;
    const timer = setTimeout(() => {
      setPreviewState('failed');
      setView('read');
    }, PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [embedUrl, previewState]);

  useEffect(() => {
    setEditing(false);
    setEditedData(initialData);
    setFieldErrors(EMPTY_FIELD_ERRORS);
  }, [item.id, initialData]);

  const retryPreview = useCallback(() => {
    setPreviewState('loading');
    setView('preview');
    onRetryPreview?.();
  }, [onRetryPreview]);

  const inlineAssetReverse = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, asset] of Object.entries(detail?.assets ?? {})) {
      if (asset?.publicUrl) map.set(asset.publicUrl, `asset://${id}`);
    }
    return map;
  }, [detail?.assets]);

  const patch = useMemo(
    () => computePatch(fields, initialData, editedData, inlineAssetReverse),
    [fields, initialData, editedData, inlineAssetReverse],
  );
  const dirty = Object.keys(patch).length > 0;

  const setField = useCallback((name: string, value: unknown) => {
    setEditedData((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedData(initialData);
    setFieldErrors(EMPTY_FIELD_ERRORS);
  }, [initialData]);

  const saveEdit = useCallback(async () => {
    if (pending || !dirty) return;
    try {
      await onSaveData(patch);
      setFieldErrors(EMPTY_FIELD_ERRORS);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        const next: Record<string, string> = {};
        for (const fe of err.fieldErrors) next[fe.field] = fe.message;
        setFieldErrors(next);
        return;
      }
      throw err;
    }
  }, [pending, dirty, patch, onSaveData]);

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
      await (group ? group.onScheduleAll(at.toISOString()) : onSchedule(at.toISOString()));
      setSchedulerOpen(false);
      setScheduledAt('');
    } catch (err) {
      console.warn('[cms-pane] schedule failed', err);
    }
  };

  useCmdEnter((event) => {
    if (readOnly) return;
    if (editing) {
      if (!pending) void saveEdit();
      return;
    }
    if (group) {
      if (pending) return;
      if (event.shiftKey && group.openPending && manyWaiting) {
        if (!blocked) onApprove();
        return;
      }
      group.onApproveAll();
      return;
    }
    if (!blocked) onApprove();
  });

  const languageStrip = group ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1.5 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
        {t('cmsLanguages')}
      </span>
      {group.translations.map((tr) => {
        const open = tr.id === item.id;
        return (
          <button
            key={tr.id}
            type="button"
            onClick={() => group.onOpen(tr.id)}
            aria-pressed={open}
            title={t(`cmsLanguageStatus.${tr.status}`, { locale: tr.locale.toUpperCase() })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[2px] border-[1px] px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-meta transition-colors duration-fast',
              open
                ? 'border-ink bg-ink text-paper dark:border-foreground dark:bg-foreground dark:text-background'
                : 'border-rule-soft text-ink hover:border-ink dark:border-rule-on-dark dark:text-foreground dark:hover:border-foreground',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-[7px] rounded-full border-[1px]',
                tr.status === 'published'
                  ? 'border-verdigris bg-verdigris dark:border-verdigris-soft dark:bg-verdigris-soft'
                  : tr.status === 'scheduled'
                    ? 'border-cobalt bg-cobalt dark:border-cobalt-soft dark:bg-cobalt-soft'
                    : tr.status === 'archived'
                      ? 'border-current bg-current opacity-40'
                      : 'border-current',
              )}
            />
            {tr.locale}
            {tr.id === group.yoursId ? (
              <span className="text-[10px] normal-case tracking-normal opacity-70">
                {t('cmsLanguageYours')}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  ) : null;

  const groupActions: PaneAction[] = group
    ? [
        ...(group.openPending
          ? [{ label: t('edit'), disabled: blocked, run: () => setEditing(true) }]
          : []),
        ...(group.openPending && manyWaiting
          ? [
              {
                label: t('cmsApproveOnly', { locale: openLocale }),
                disabled: blocked,
                run: onApprove,
              },
              {
                label: t('cmsDismissLocale', { locale: openLocale }),
                disabled: blocked,
                run: onDismiss,
              },
            ]
          : []),
        {
          label: manyWaiting
            ? t('cmsScheduleAll', { count: waitingLocales.length })
            : t('cmsScheduleLocale', { locale: (waitingLocales[0] ?? '').toUpperCase() }),
          disabled: pending,
          run: openScheduler,
        },
        {
          label: manyWaiting
            ? t('cmsDismissAll', { count: waitingLocales.length })
            : t('cmsDismissLocale', { locale: (waitingLocales[0] ?? '').toUpperCase() }),
          disabled: pending,
          run: group.onDismissAll,
        },
      ]
    : [];

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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-full flex-col">
          <PaneHeader
            kind="cms"
            pillLabel={tQueue('kindCms')}
            title={item.title}
            meta={
              group
                ? t('metaCmsGroup', {
                    collection: item.raw.collectionName,
                    age: age(item.createdAt),
                    count: group.translations.length,
                  })
                : t('metaCms', {
                    collection: item.raw.collectionName,
                    age: age(item.createdAt),
                  })
            }
            rightExtra={readOnly ? <Pill tone="review">{t('scheduledPill')}</Pill> : undefined}
            below={languageStrip}
            onClose={onClose}
            closeLabel={t('close')}
            className={hideHeaderOnMobile ? 'max-md:hidden' : undefined}
          />
          {languageStrip && hideHeaderOnMobile ? (
            <div className="border-b-[1px] border-rule-soft px-5 py-3 md:hidden dark:border-rule-on-dark">
              {languageStrip}
            </div>
          ) : null}

          {detail ? (
            <>
              {hasPreviewUrl || canCompare ? (
                <ViewTabRow>
                  {showPreviewTab ? (
                    <ViewTab
                      active={activeView === 'preview'}
                      warn={previewState === 'failed'}
                      onSelect={() => setView('preview')}
                    >
                      {t('cmsViewPreview')}
                    </ViewTab>
                  ) : null}
                  <ViewTab
                    active={activeView === 'read' || (activeView === 'preview' && !showPreviewTab)}
                    onSelect={() => setView('read')}
                  >
                    {t('cmsViewRead')}
                  </ViewTab>
                  {canCompare && reference ? (
                    <ViewTab active={activeView === 'compare'} onSelect={() => setView('compare')}>
                      {t('cmsViewCompare', { locale: reference.locale.toUpperCase() })}
                    </ViewTab>
                  ) : null}
                  {previewUrl ? (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto inline-flex items-center gap-1 py-3 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt hover:underline dark:text-cobalt-soft"
                    >
                      {t('cmsOpenPreview')}
                      <MetaArrow glyph="↗" />
                    </a>
                  ) : null}
                </ViewTabRow>
              ) : null}

              {activeView === 'compare' && reference ? (
                <CompareView
                  fields={fields}
                  reference={reference}
                  openLocale={detail.locale}
                  openSlug={detail.slug}
                  openData={initialData}
                  openRefs={detail.refs}
                  yoursLabel={t('cmsLanguageYours')}
                  slugLabel={t('cmsCompareSlug')}
                  loadingLabel={t('loading')}
                  aspectLabel={t('cmsCoverAspect')}
                />
              ) : showPreviewTab && activeView === 'preview' ? (
                <PreviewStage address={t('cmsPreviewAddress', { path: previewPath(previewUrl) })}>
                  {previewState !== 'ready' ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-paper dark:bg-background">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                        {t('cmsPreviewLoading')}
                      </span>
                    </div>
                  ) : null}
                  <iframe
                    key={embedUrl ?? 'preview'}
                    src={embedUrl ?? undefined}
                    title={t('cmsPreviewTitle')}
                    sandbox="allow-scripts allow-same-origin allow-popups"
                    referrerPolicy="no-referrer"
                    onLoad={(e) => {
                      if (frameStayedBlank(e.currentTarget)) {
                        setPreviewState('failed');
                        setView('read');
                        return;
                      }
                      setPreviewState('ready');
                    }}
                    onError={() => {
                      setPreviewState('failed');
                      setView('read');
                    }}
                    className={cn(
                      'absolute inset-0 size-full border-0 bg-paper dark:bg-background',
                      previewState !== 'ready' && 'opacity-0',
                    )}
                  />
                </PreviewStage>
              ) : (
                <div className="space-y-6 px-5 py-5 md:px-7">
                  {blockedEmbed && !editing ? (
                    <PaneNotice eyebrow={t('cmsPreviewBlockedEyebrow')}>
                      {blockedEmbed.reason === 'x_frame_options'
                        ? t('cmsPreviewBlockedXfo', {
                            host: blockedEmbed.previewHost,
                            value: blockedEmbed.detail ?? '',
                          })
                        : t('cmsPreviewBlockedCsp', {
                            host: blockedEmbed.previewHost,
                            value: blockedEmbed.detail ?? '',
                            embedder: blockedEmbed.embedderOrigin,
                          })}
                    </PaneNotice>
                  ) : previewState === 'failed' && !editing ? (
                    <PaneNotice
                      eyebrow={t('cmsPreviewFailedEyebrow')}
                      action={
                        <button
                          type="button"
                          onClick={retryPreview}
                          className="inline-flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-cobalt hover:underline dark:text-cobalt-soft"
                        >
                          {tCommon('retry')}
                          <MetaArrow glyph="⟳" />
                        </button>
                      }
                    >
                      {t('cmsPreviewFailedBody')}
                    </PaneNotice>
                  ) : null}
                  {readOnly && scheduledPublishAt && (
                    <ScheduledNotice
                      headline={t('scheduledCmsHeadline', {
                        when: format.dateTime(new Date(scheduledPublishAt), {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                      })}
                      detail={t('scheduledCmsDetail', { collection: item.raw.collectionName })}
                    />
                  )}
                  {fields.map((field) => (
                    <FieldSection
                      key={field.name}
                      field={field}
                      value={editedData[field.name]}
                      error={fieldErrors[field.name] ?? null}
                      editing={editing}
                      disabled={pending}
                      hideInReadMode={field.name === item.raw.titleFieldName}
                      onChange={(v) => setField(field.name, v)}
                      onUploadAsset={onUploadAsset}
                      refs={detail?.refs}
                      entryLocale={detail?.locale}
                    />
                  ))}
                </div>
              )}
            </>
          ) : loadError !== undefined ? (
            <div className="flex min-h-[320px] flex-1 flex-col">
              <PaneLoadFailed
                eyebrow={t('loadFailedEyebrow')}
                title={t('detailLoadFailed')}
                reason={loadError}
                retryLabel={tCommon('retry')}
                retryingLabel={tCommon('retrying')}
                onRetry={onRetry}
              />
            </div>
          ) : (
            <div className="flex min-h-[320px] flex-1 flex-col">
              <PaneLoadingState label={t('loading')} />
            </div>
          )}
        </div>
      </div>

      {readOnly ? (
        loadFailed ? null : (
          <ScheduledFooter
            cancelLabel={t('scheduledCmsCancel')}
            onCancel={() => onCancelScheduled?.()}
            disabled={pending || !onCancelScheduled}
            note={t('scheduledNote')}
          />
        )
      ) : editing ? (
        <PaneFooter
          primary={{ label: t('save'), onClick: () => void saveEdit(), disabled: pending || !dirty }}
          secondary={[{ label: t('cancel'), onClick: cancelEdit, variant: 'ghost' }]}
          shortcut={t('shortcutSave')}
          error={paneError}
          onClearError={onClearActionError}
        />
      ) : loadFailed ? null : group ? (
        <PaneFooter
          primary={{
            label: manyWaiting
              ? t('cmsApproveAll', { count: waitingLocales.length })
              : t('cmsApproveLocale', { locale: (waitingLocales[0] ?? '').toUpperCase() }),
            onClick: group.onApproveAll,
            disabled: pending,
            arrow: true,
          }}
          secondary={
            group.openPending
              ? [{ label: t('edit'), onClick: () => setEditing(true), disabled: blocked }]
              : []
          }
          sheetActions={groupActions}
          extra={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      disabled={pending}
                      aria-label={tCommon('moreActions')}
                      className="w-11 px-0 max-md:hidden"
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-auto min-w-60">
                  {group.openPending && manyWaiting ? (
                    <>
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>
                          {t('cmsMenuOnly', { locale: openLocale })}
                        </DropdownMenuLabel>
                        <DropdownMenuItem disabled={blocked} onClick={onApprove}>
                          {t('cmsApproveOnly', { locale: openLocale })}
                          <DropdownMenuShortcut>⇧⌘↵</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={blocked} onClick={onDismiss}>
                          {t('cmsDismissLocale', { locale: openLocale })}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuGroup>
                    {manyWaiting ? (
                      <DropdownMenuLabel>
                        {t('cmsMenuAll', { count: waitingLocales.length })}
                      </DropdownMenuLabel>
                    ) : null}
                    <DropdownMenuItem disabled={pending} onClick={openScheduler}>
                      {manyWaiting
                        ? t('cmsScheduleAll', { count: waitingLocales.length })
                        : t('cmsScheduleLocale', {
                            locale: (waitingLocales[0] ?? '').toUpperCase(),
                          })}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={pending} onClick={group.onDismissAll}>
                      {manyWaiting
                        ? t('cmsDismissAll', { count: waitingLocales.length })
                        : t('cmsDismissLocale', {
                            locale: (waitingLocales[0] ?? '').toUpperCase(),
                          })}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {group.openPending ? null : (
                <span className="text-[13px] text-ink-mute dark:text-foreground/60">
                  {t(`cmsLanguageStatus.${openStatus}`, { locale: openLocale })}
                </span>
              )}
            </>
          }
          shortcut={
            group.openPending && manyWaiting
              ? t('shortcutCmsApproveAll', { locale: openLocale })
              : t('shortcutCmsApprove')
          }
          error={paneError}
          onClearError={onClearActionError}
        />
      ) : (
        <PaneFooter
          primary={{ label: t('cmsApprove'), onClick: onApprove, disabled: blocked, arrow: true }}
          secondary={[
            { label: t('edit'), onClick: () => setEditing(true), disabled: blocked },
            { label: t('cmsSchedule'), onClick: openScheduler, disabled: blocked },
            { label: t('cmsDismiss'), onClick: onDismiss, disabled: blocked, variant: 'ghost' },
          ]}
          shortcut={t('shortcutCmsApprove')}
          error={paneError}
          onClearError={onClearActionError}
        />
      )}

      {readOnly ? null : (
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
              <DialogDescription>
                {group && manyWaiting
                  ? t('cmsScheduleAllDescription', { count: waitingLocales.length })
                  : t('cmsScheduleDescription')}
              </DialogDescription>
            </DialogHeader>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitSchedule();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                  {t('cmsScheduleLabel')}
                </span>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => {
                    setScheduledAt(e.target.value);
                    if (scheduleError) setScheduleError(null);
                  }}
                  className="rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
                  autoFocus
                />
              </label>
              {scheduleError && (
                <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-destructive">
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
      )}
    </>
  );
}

const PREVIEW_TIMEOUT_MS = 15000;

function frameStayedBlank(frame: HTMLIFrameElement): boolean {
  try {
    return frame.contentWindow?.location.href === 'about:blank';
  } catch {
    return false;
  }
}

function withEmbedParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('munin_embed', '1');
    return parsed.toString();
  } catch {
    return url;
  }
}

function previewPath(url: string | null): string {
  if (!url) return '';
  try {
    return decodeURI(new URL(url).pathname);
  } catch {
    return url;
  }
}

function CompareView({
  fields,
  reference,
  openLocale,
  openSlug,
  openData,
  openRefs,
  yoursLabel,
  slugLabel,
  loadingLabel,
  aspectLabel,
}: {
  fields: CmsFieldDef[];
  reference: NonNullable<CmsPaneGroup['reference']>;
  openLocale: string;
  openSlug: string;
  openData: EditableData;
  openRefs: Record<string, CmsRefExpanded> | undefined;
  yoursLabel: string;
  slugLabel: string;
  loadingLabel: string;
  aspectLabel: string;
}) {
  if (!reference.detail) {
    return (
      <div className="flex min-h-[320px] flex-1 flex-col">
        {reference.loadError !== undefined ? (
          <p className="px-5 py-5 text-sm text-ink-mute md:px-7">{reference.loadError}</p>
        ) : (
          <PaneLoadingState label={loadingLabel} />
        )}
      </div>
    );
  }
  const referenceDetail = reference.detail;
  const labelClass = 'font-mono text-[10px] font-medium uppercase tracking-eyebrow';
  const columns = 'grid grid-cols-1 gap-x-7 gap-y-2 sm:grid-cols-2';
  const rows = fields.filter(
    (field) => !isEmpty(referenceDetail.data[field.name]) || !isEmpty(openData[field.name]),
  );
  return (
    <div className="px-5 pb-6 md:px-7">
      <div className={cn(columns, 'pb-1 pt-4 max-sm:hidden')}>
        <span className={cn(labelClass, 'text-ink-label')}>
          {reference.locale.toUpperCase()}
          {reference.yours ? ` · ${yoursLabel}` : ''}
        </span>
        <span className={cn(labelClass, 'text-ink-label')}>{openLocale.toUpperCase()}</span>
      </div>
      <section className="space-y-2 border-b-[1px] border-rule-soft py-4 dark:border-rule-on-dark">
        <p className={cn(labelClass, 'text-ink-mute')}>{slugLabel}</p>
        <div className={columns}>
          <p className="break-all font-mono text-[13px] text-ink-mute">{referenceDetail.slug}</p>
          <p className="break-all font-mono text-[13px] text-ink dark:text-foreground">{openSlug}</p>
        </div>
      </section>
      {rows.map((field) => (
        <section
          key={field.name}
          className="space-y-2 border-b-[1px] border-rule-soft py-4 last:border-b-0 dark:border-rule-on-dark"
        >
          <p className={cn(labelClass, 'text-ink-mute')}>{humanizeFieldName(field.name)}</p>
          <div className={columns}>
            <div className="min-w-0 opacity-70">
              <FieldViewer
                field={field}
                value={referenceDetail.data[field.name]}
                aspectLabel={aspectLabel}
                refs={referenceDetail.refs}
                entryLocale={referenceDetail.locale}
              />
            </div>
            <div className="min-w-0">
              <FieldViewer
                field={field}
                value={openData[field.name]}
                aspectLabel={aspectLabel}
                refs={openRefs}
                entryLocale={openLocale}
              />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

const EMPTY_FIELDS: CmsFieldDef[] = [];
const EMPTY_DATA: EditableData = {};
const EMPTY_FIELD_ERRORS: Record<string, string> = {};

function FieldSection({
  field,
  value,
  error,
  editing,
  disabled,
  hideInReadMode,
  onChange,
  onUploadAsset,
  refs,
  entryLocale,
}: {
  field: CmsFieldDef;
  value: unknown;
  error: string | null;
  editing: boolean;
  disabled: boolean;
  hideInReadMode: boolean;
  onChange: (next: unknown) => void;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  refs: Record<string, CmsRefExpanded> | undefined;
  entryLocale: string | undefined;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  if (!editing && (hideInReadMode || isEmpty(value))) return null;
  return (
    <section className="space-y-2">
      <p
        className={cn(
          'font-mono text-[10px] font-medium uppercase tracking-eyebrow',
          error ? 'text-destructive' : 'text-ink-mute',
        )}
      >
        {humanizeFieldName(field.name)}
      </p>
      {editing && field.description && (
        <p className="font-sans text-xs text-ink-mute">{field.description}</p>
      )}
      {editing ? (
        <FieldEditor
          field={field}
          value={value}
          invalid={error != null}
          disabled={disabled}
          onChange={onChange}
          onUploadAsset={onUploadAsset}
          aspectLabel={t('cmsCoverAspect')}
          dropHintLabel={t('cmsCoverDropHint')}
          dropActiveLabel={t('cmsCoverDropActive')}
          uploadingLabel={t('cmsCoverUploading')}
          replaceLabel={t('cmsCoverReplace')}
        />
      ) : (
        <FieldViewer
          field={field}
          value={value}
          aspectLabel={t('cmsCoverAspect')}
          refs={refs}
          entryLocale={entryLocale}
        />
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function FieldEditor({
  field,
  value,
  invalid,
  disabled,
  onChange,
  onUploadAsset,
  aspectLabel,
  dropHintLabel,
  dropActiveLabel,
  uploadingLabel,
  replaceLabel,
}: {
  field: CmsFieldDef;
  value: unknown;
  invalid: boolean;
  disabled: boolean;
  onChange: (next: unknown) => void;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  aspectLabel: string;
  dropHintLabel: string;
  dropActiveLabel: string;
  uploadingLabel: string;
  replaceLabel: string;
}) {
  const inputClass = cn(
    'w-full rounded-input border-[1px] bg-paper px-4 py-2 font-sans text-sm leading-relaxed outline-none focus-visible:ring-1 dark:bg-card dark:text-foreground',
    invalid
      ? 'border-destructive focus-visible:ring-destructive'
      : 'border-cobalt focus-visible:ring-cobalt',
  );
  const textareaClass = cn(
    'w-full resize-y rounded-input border-[1px] bg-paper px-4 py-3 font-sans text-sm leading-relaxed outline-none focus-visible:ring-1 dark:bg-card dark:text-foreground',
    invalid
      ? 'border-destructive focus-visible:ring-destructive'
      : 'border-cobalt focus-visible:ring-cobalt',
  );
  switch (field.type) {
    case 'text':
      return (
        <input
          type="text"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={inputClass}
        />
      );
    case 'markdown':
    case 'rich_text':
      return (
        <textarea
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === 'markdown' ? 9 : 6}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={textareaClass}
        />
      );
    case 'integer':
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          step={field.type === 'integer' ? 1 : 'any'}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const n = field.type === 'integer' ? parseInt(raw, 10) : Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={inputClass}
        />
      );
    case 'boolean':
      return (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            aria-invalid={invalid || undefined}
          />
          <span className="font-sans text-sm">{value === true ? 'true' : 'false'}</span>
        </label>
      );
    case 'select':
      return (
        <NativeSelect
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-auto pl-4 py-2 text-sm leading-relaxed',
            invalid
              ? 'border-destructive focus-visible:border-destructive'
              : 'border-cobalt focus-visible:border-cobalt',
          )}
        >
          <option value="">—</option>
          {(field.options?.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      );
    case 'date':
      return (
        <input
          type="date"
          value={asString(value).slice(0, 10)}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={inputClass}
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={asString(value).slice(0, 16)}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={inputClass}
        />
      );
    case 'asset':
      return (
        <AssetDropZone
          asset={asAsset(value)}
          invalid={invalid}
          disabled={disabled}
          aspectLabel={aspectLabel}
          hintLabel={dropHintLabel}
          activeLabel={dropActiveLabel}
          uploadingLabel={uploadingLabel}
          replaceLabel={replaceLabel}
          onUploadAsset={onUploadAsset}
          onChange={onChange}
        />
      );
    case 'multi_select':
      return (
        <MultiSelectEditor
          choices={field.options?.choices ?? []}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'array':
      return (
        <ListEditor
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
          onUploadAsset={onUploadAsset}
          assetLabels={{
            aspectLabel,
            dropHintLabel,
            dropActiveLabel,
            uploadingLabel,
            replaceLabel,
          }}
        />
      );
    case 'blocks':
      return (
        <BlocksEditor
          field={field}
          value={value}
          disabled={disabled}
          onChange={onChange}
          onUploadAsset={onUploadAsset}
          assetLabels={{
            aspectLabel,
            dropHintLabel,
            dropActiveLabel,
            uploadingLabel,
            replaceLabel,
          }}
        />
      );
    default:
      return (
        <pre className="w-full overflow-x-auto rounded-input border-[1px] border-rule-soft bg-paper-deep px-3 py-2 font-mono text-xs text-ink-mute dark:border-rule-on-dark dark:bg-secondary">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
  }
}

export function FieldViewer({
  field,
  value,
  aspectLabel,
  refs,
  entryLocale,
}: {
  field: CmsFieldDef;
  value: unknown;
  aspectLabel: string;
  refs: Record<string, CmsRefExpanded> | undefined;
  entryLocale: string | undefined;
}) {
  switch (field.type) {
    case 'markdown':
    case 'rich_text':
      return (
        <ValueBox>
          <Markdown refs={refs} locale={entryLocale}>
            {asString(value)}
          </Markdown>
        </ValueBox>
      );
    case 'asset': {
      const asset = asAsset(value);
      if (!asset) return null;
      return <AssetFigure asset={asset} aspectLabel={aspectLabel} />;
    }
    case 'blocks':
      return (
        <BlocksViewer
          field={field}
          value={value}
          aspectLabel={aspectLabel}
          refs={refs}
          entryLocale={entryLocale}
        />
      );
    case 'multi_select': {
      const items = Array.isArray(value) ? (value as unknown[]) : [];
      return <ValueBox>{items.map(scalarText).filter(Boolean).join(', ') || '—'}</ValueBox>;
    }
    case 'array':
      return (
        <ArrayViewer
          field={field}
          value={value}
          aspectLabel={aspectLabel}
          refs={refs}
          entryLocale={entryLocale}
        />
      );
    case 'boolean':
      return <ValueBox>{value === true ? 'true' : 'false'}</ValueBox>;
    case 'date':
      return <ValueBox>{formatDateValue(value, false) || '—'}</ValueBox>;
    case 'datetime':
      return <ValueBox>{formatDateValue(value, true) || '—'}</ValueBox>;
    case 'text':
      if (field.inlineRefs) {
        return (
          <ValueBox>
            <Markdown refs={refs} locale={entryLocale}>
              {asString(value)}
            </Markdown>
          </ValueBox>
        );
      }
      return <ValueBox>{asString(value) || '—'}</ValueBox>;
    case 'select':
    case 'integer':
    case 'number':
      return <ValueBox>{asString(value) || '—'}</ValueBox>;
    default:
      return (
        <ValueBox>
          <pre className="w-full overflow-x-auto font-mono text-xs text-ink-mute">
            {JSON.stringify(value, null, 2)}
          </pre>
        </ValueBox>
      );
  }
}

function ValueBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-[1px] border-ink bg-paper px-4 py-3 font-sans text-sm leading-relaxed text-ink dark:bg-card dark:border-rule-on-dark dark:text-foreground">
      {children}
    </div>
  );
}

interface AssetLabels {
  aspectLabel: string;
  dropHintLabel: string;
  dropActiveLabel: string;
  uploadingLabel: string;
  replaceLabel: string;
}

function BlockCard({
  label,
  controls,
  children,
}: {
  label: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border-[1px] border-rule-soft bg-paper-deep/50 p-3 dark:border-rule-on-dark dark:bg-secondary/40">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
          {label}
        </span>
        {controls}
      </div>
      {children}
    </div>
  );
}

function BlockProp({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

function BlockPropLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">{children}</p>
  );
}

function BlocksViewer({
  field,
  value,
  aspectLabel,
  refs,
  entryLocale,
}: {
  field: CmsFieldDef;
  value: unknown;
  aspectLabel: string;
  refs: Record<string, CmsRefExpanded> | undefined;
  entryLocale: string | undefined;
}) {
  const blocks: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-3">
      {blocks.map((raw, index) => {
        const block = asBlock(raw);
        const bt = block ? blockTypeDef(field, block.type) : null;
        const key = block?.key ?? `block-${index}`;
        if (!block || !bt) {
          return (
            <BlockCard key={key} label={block?.type ?? 'block'}>
              <pre className="w-full overflow-x-auto font-mono text-xs text-ink-mute">
                {JSON.stringify(block?.props ?? raw, null, 2)}
              </pre>
            </BlockCard>
          );
        }
        const visible = bt.fields.filter((pf) => !isEmpty(block.props[pf.name]));
        return (
          <BlockCard key={key} label={blockTypeLabel(bt)}>
            {visible.length === 0 ? (
              <p className="font-sans text-sm text-ink-mute">—</p>
            ) : (
              visible.map((pf) => (
                <BlockProp key={pf.name}>
                  <BlockPropLabel>{humanizeFieldName(pf.name)}</BlockPropLabel>
                  <FieldViewer
                    field={pf}
                    value={block.props[pf.name]}
                    aspectLabel={aspectLabel}
                    refs={refs}
                    entryLocale={entryLocale}
                  />
                </BlockProp>
              ))
            )}
          </BlockCard>
        );
      })}
    </div>
  );
}

function ArrayViewer({
  field,
  value,
  aspectLabel,
  refs,
  entryLocale,
}: {
  field: CmsFieldDef;
  value: unknown;
  aspectLabel: string;
  refs: Record<string, CmsRefExpanded> | undefined;
  entryLocale: string | undefined;
}) {
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  if (items.length === 0) return null;
  const itemDef = field.options?.items;
  if (itemDef?.type === 'asset') {
    return (
      <div className="space-y-2">
        {items.map((it, index) => (
          <FieldViewer
            key={index}
            field={itemDef}
            value={it}
            aspectLabel={aspectLabel}
            refs={refs}
            entryLocale={entryLocale}
          />
        ))}
      </div>
    );
  }
  return (
    <ValueBox>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((it, index) => (
          <li key={index}>
            {field.inlineRefs && typeof it === 'string' ? (
              <Markdown refs={refs} locale={entryLocale}>
                {it}
              </Markdown>
            ) : (
              scalarText(it) || '—'
            )}
          </li>
        ))}
      </ul>
    </ValueBox>
  );
}

function MultiSelectEditor({
  choices,
  value,
  disabled,
  onChange,
}: {
  choices: string[];
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}) {
  const selected = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return (
    <div className="flex flex-col gap-1.5">
      {choices.map((c) => (
        <label key={c} className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected.includes(c)}
            disabled={disabled}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(c);
              else next.delete(c);
              onChange(choices.filter((choice) => next.has(choice)));
            }}
          />
          <span className="font-sans text-sm">{c}</span>
        </label>
      ))}
    </div>
  );
}

function ListEditor({
  field,
  value,
  disabled,
  onChange,
  onUploadAsset,
  assetLabels,
}: {
  field: CmsFieldDef;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  assetLabels: AssetLabels;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  const itemDef = field.options?.items;

  if (!itemDef) {
    return (
      <pre className="w-full overflow-x-auto rounded-input border-[1px] border-rule-soft bg-paper-deep px-3 py-2 font-mono text-xs text-ink-mute dark:border-rule-on-dark dark:bg-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const setItem = (index: number, next: unknown) =>
    onChange(items.map((it, i) => (i === index ? next : it)));
  const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index));
  const moveItem = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const addItem = () => onChange([...items, defaultForField(itemDef)]);

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <FieldEditor
              field={{ ...itemDef, name: `${field.name}.${index}` }}
              value={item}
              invalid={false}
              disabled={disabled}
              onChange={(v) => setItem(index, v)}
              onUploadAsset={onUploadAsset}
              aspectLabel={assetLabels.aspectLabel}
              dropHintLabel={assetLabels.dropHintLabel}
              dropActiveLabel={assetLabels.dropActiveLabel}
              uploadingLabel={assetLabels.uploadingLabel}
              replaceLabel={assetLabels.replaceLabel}
            />
          </div>
          <div className="flex items-center gap-1 pt-1.5">
            <BlockControl
              label={t('cmsListMoveUp')}
              disabled={disabled || index === 0}
              onClick={() => moveItem(index, -1)}
            >
              <ChevronUp className="size-3.5" />
            </BlockControl>
            <BlockControl
              label={t('cmsListMoveDown')}
              disabled={disabled || index === items.length - 1}
              onClick={() => moveItem(index, 1)}
            >
              <ChevronDown className="size-3.5" />
            </BlockControl>
            <BlockControl
              label={t('cmsListRemove')}
              disabled={disabled}
              onClick={() => removeItem(index)}
            >
              <Trash2 className="size-3.5" />
            </BlockControl>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" disabled={disabled} onClick={addItem}>
        <Plus className="size-3.5" />
        {t('cmsListAdd')}
      </Button>
    </div>
  );
}

function BlocksEditor({
  field,
  value,
  disabled,
  onChange,
  onUploadAsset,
  assetLabels,
}: {
  field: CmsFieldDef;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  assetLabels: AssetLabels;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const blocks: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  const blockTypes = field.options?.blockTypes ?? [];

  const replaceBlock = (index: number, next: unknown) =>
    onChange(blocks.map((b, i) => (i === index ? next : b)));

  const setProp = (index: number, propName: string, propValue: unknown) => {
    const block = asBlock(blocks[index]);
    if (!block) return;
    replaceBlock(index, {
      ...(blocks[index] as Record<string, unknown>),
      props: { ...block.props, [propName]: propValue },
    });
  };

  const removeBlock = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  const moveBlock = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addBlock = (bt: CmsBlockTypeDef) => onChange([...blocks, seedBlock(bt)]);

  return (
    <div className="space-y-3">
      {blocks.map((raw, index) => {
        const block = asBlock(raw);
        const bt = block ? blockTypeDef(field, block.type) : null;
        const key = block?.key ?? `block-${index}`;
        const controls = (
          <div className="flex items-center gap-1">
            <BlockControl
              label={t('cmsBlockMoveUp')}
              disabled={disabled || index === 0}
              onClick={() => moveBlock(index, -1)}
            >
              <ChevronUp className="size-3.5" />
            </BlockControl>
            <BlockControl
              label={t('cmsBlockMoveDown')}
              disabled={disabled || index === blocks.length - 1}
              onClick={() => moveBlock(index, 1)}
            >
              <ChevronDown className="size-3.5" />
            </BlockControl>
            <BlockControl
              label={t('cmsBlockRemove')}
              disabled={disabled}
              onClick={() => removeBlock(index)}
            >
              <Trash2 className="size-3.5" />
            </BlockControl>
          </div>
        );
        if (!block || !bt) {
          return (
            <BlockCard key={key} label={block?.type ?? 'block'} controls={controls}>
              <pre className="w-full overflow-x-auto font-mono text-xs text-ink-mute">
                {JSON.stringify(block?.props ?? raw, null, 2)}
              </pre>
            </BlockCard>
          );
        }
        return (
          <BlockCard key={key} label={blockTypeLabel(bt)} controls={controls}>
            {bt.fields.map((pf) => (
              <BlockProp key={pf.name}>
                <BlockPropLabel>{humanizeFieldName(pf.name)}</BlockPropLabel>
                {pf.description && (
                  <p className="font-sans text-xs text-ink-mute">{pf.description}</p>
                )}
                <FieldEditor
                  field={pf}
                  value={block.props[pf.name]}
                  invalid={false}
                  disabled={disabled}
                  onChange={(v) => setProp(index, pf.name, v)}
                  onUploadAsset={onUploadAsset}
                  aspectLabel={assetLabels.aspectLabel}
                  dropHintLabel={assetLabels.dropHintLabel}
                  dropActiveLabel={assetLabels.dropActiveLabel}
                  uploadingLabel={assetLabels.uploadingLabel}
                  replaceLabel={assetLabels.replaceLabel}
                />
              </BlockProp>
            ))}
          </BlockCard>
        );
      })}
      {blockTypes.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" disabled={disabled} />}
          >
            <Plus className="size-3.5" />
            {t('cmsBlockAdd')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {blockTypes.map((bt) => (
              <DropdownMenuItem key={bt.name} disabled={disabled} onClick={() => addBlock(bt)}>
                <span className="flex flex-col">
                  <span>{blockTypeLabel(bt)}</span>
                  {bt.description && (
                    <span className="text-xs text-ink-mute">{bt.description}</span>
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function BlockControl({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded-input text-ink-mute transition hover:text-ink disabled:pointer-events-none disabled:opacity-40 dark:hover:text-foreground"
    >
      {children}
    </button>
  );
}

function AssetFigure({
  asset,
  aspectLabel,
}: {
  asset: CmsAssetExpanded;
  aspectLabel: string;
}) {
  return (
    <figure className="border-[1px] border-ink bg-paper dark:border-rule-on-dark dark:bg-card">
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <img
          src={asset.publicUrl}
          alt={asset.altText ?? ''}
          className="size-full object-cover"
        />
        <span className="absolute right-2 bottom-2 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label bg-paper/85 px-1.5 py-0.5 dark:bg-card/85">
          {aspectLabel}
        </span>
      </div>
    </figure>
  );
}

function AssetDropZone({
  asset,
  invalid,
  disabled,
  aspectLabel,
  hintLabel,
  activeLabel,
  uploadingLabel,
  replaceLabel,
  onUploadAsset,
  onChange,
}: {
  asset: CmsAssetExpanded | null;
  invalid: boolean;
  disabled: boolean;
  aspectLabel: string;
  hintLabel: string;
  activeLabel: string;
  uploadingLabel: string;
  replaceLabel: string;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  onChange: (next: CmsAssetExpanded | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    async (file: File) => {
      if (uploading || disabled) return;
      setUploading(true);
      try {
        const uploaded = await onUploadAsset(file);
        onChange(uploaded);
      } catch (err) {
        console.warn('[cms-pane] asset upload failed', err);
      } finally {
        setUploading(false);
      }
    },
    [uploading, disabled, onUploadAsset, onChange],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) void accept(file);
    },
    [accept],
  );

  const interactionsDisabled = disabled || uploading;
  return (
    <>
      <figure className="border-[1px] border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-card">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!interactionsDisabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (interactionsDisabled) {
              e.preventDefault();
              return;
            }
            onDrop(e);
          }}
          disabled={interactionsDisabled}
          aria-label={asset ? replaceLabel : hintLabel}
          aria-invalid={invalid || undefined}
          className={cn(
            'group relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden border-[1px] border-dashed text-center transition',
            invalid
              ? 'border-destructive bg-destructive/5'
              : dragging
              ? 'border-cobalt bg-cobalt/5'
              : 'border-rule-soft bg-paper-deep hover:border-cobalt/60 dark:border-rule-on-dark dark:bg-secondary',
            interactionsDisabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {asset ? (
            <>
              <img
                src={asset.publicUrl}
                alt={asset.altText ?? ''}
                className="absolute inset-0 size-full object-cover"
              />
              <div
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-opacity',
                  dragging || uploading
                    ? 'bg-paper/70 opacity-100 dark:bg-card/70'
                    : 'bg-paper/70 opacity-0 group-hover:opacity-100 dark:bg-card/70',
                )}
              >
                <span className="font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
                  {uploading ? uploadingLabel : dragging ? activeLabel : replaceLabel}
                </span>
              </div>
            </>
          ) : (
            <span className="relative font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label">
              {uploading ? uploadingLabel : dragging ? activeLabel : hintLabel}
            </span>
          )}
          <span className="absolute right-2 bottom-2 font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-label bg-paper/85 px-1.5 py-0.5 dark:bg-card/85">
            {aspectLabel}
          </span>
        </button>
      </figure>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void accept(file);
        }}
      />
    </>
  );
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatDateValue(value: unknown, withTime: boolean): string {
  const raw = asString(value);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function scalarText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

function asAsset(value: unknown): CmsAssetExpanded | null {
  if (!value || typeof value !== 'object') return null;
  return readAssetField({ v: value }, 'v');
}

export function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function tomorrowLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setSeconds(0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

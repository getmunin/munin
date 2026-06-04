'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import { MoreHorizontal } from 'lucide-react';
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { useRelative } from '../../../lib/use-relative';
import { DrawerFooter, DrawerHeader, MD_COMPONENTS, useCmdEnter } from './shared';
import {
  humanizeFieldName,
  readAssetField,
  type CmsAssetExpanded,
  type CmsDraftDetailDto,
  type CmsDraftSummaryDto,
  type CmsFieldDef,
} from './types';

type EditableData = Record<string, unknown>;

export function CmsQueueDrawer({
  item,
  detail,
  pending,
  onApprove,
  onDismiss,
  onSaveData,
  onUploadAsset,
  onSchedule,
  onClose,
}: {
  item: { id: string; title: string; createdAt: string; raw: CmsDraftSummaryDto };
  detail: CmsDraftDetailDto | undefined;
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSaveData: (data: EditableData) => Promise<void>;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
  onSchedule: (scheduledAt: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();

  const fields = detail?.fields ?? EMPTY_FIELDS;
  const initialData: EditableData = detail?.data ?? EMPTY_DATA;

  const [editing, setEditing] = useState(false);
  const [editedData, setEditedData] = useState<EditableData>(initialData);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(EMPTY_FIELD_ERRORS);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setEditedData(initialData);
    setFieldErrors(EMPTY_FIELD_ERRORS);
  }, [item.id, initialData]);

  const patch = useMemo(
    () => computePatch(fields, initialData, editedData),
    [fields, initialData, editedData],
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
      await onSchedule(at.toISOString());
      setSchedulerOpen(false);
      setScheduledAt('');
    } catch (err) {
      console.warn('[cms-drawer] schedule failed', err);
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
        {detail ? (
          fields.map((field) => (
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
            />
          ))
        ) : (
          <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed text-ink-mute italic dark:bg-card dark:border-rule-on-dark">
            {t('loading')}
          </div>
        )}
      </div>

      {editing ? (
        <DrawerFooter
          primary={{
            label: t('save'),
            onClick: () => void saveEdit(),
            disabled: pending || !dirty,
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
}: {
  field: CmsFieldDef;
  value: unknown;
  error: string | null;
  editing: boolean;
  disabled: boolean;
  hideInReadMode: boolean;
  onChange: (next: unknown) => void;
  onUploadAsset: (file: File) => Promise<CmsAssetExpanded>;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  if (!editing && (hideInReadMode || isEmpty(value))) return null;
  return (
    <section className="space-y-2">
      <p
        className={cn(
          'font-mono text-[10px] uppercase tracking-eyebrow',
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
        <FieldViewer field={field} value={value} aspectLabel={t('cmsCoverAspect')} />
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
    'w-full rounded-input border-[0.5px] bg-paper px-4 py-2 font-sans text-[15px] leading-7 outline-none focus-visible:ring-1 dark:bg-card dark:text-foreground',
    invalid
      ? 'border-destructive focus-visible:ring-destructive'
      : 'border-cobalt focus-visible:ring-cobalt',
  );
  const textareaClass = cn(
    'w-full resize-y rounded-input border-[0.5px] bg-paper px-4 py-3 font-sans text-[15px] leading-7 outline-none focus-visible:ring-1 dark:bg-card dark:text-foreground',
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
          rows={field.type === 'markdown' ? 18 : 6}
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
        <select
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={inputClass}
        >
          <option value="">—</option>
          {(field.options?.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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
    default:
      return (
        <pre className="w-full overflow-x-auto rounded-input border-[0.5px] border-rule-soft bg-paper-deep px-3 py-2 font-mono text-xs text-ink-mute dark:border-rule-on-dark dark:bg-secondary">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
  }
}

function FieldViewer({
  field,
  value,
  aspectLabel,
}: {
  field: CmsFieldDef;
  value: unknown;
  aspectLabel: string;
}) {
  switch (field.type) {
    case 'markdown':
    case 'rich_text':
      return (
        <ValueBox>
          <ReactMarkdown components={MD_COMPONENTS}>{asString(value)}</ReactMarkdown>
        </ValueBox>
      );
    case 'asset': {
      const asset = asAsset(value);
      if (!asset) return null;
      return <AssetFigure asset={asset} aspectLabel={aspectLabel} />;
    }
    case 'boolean':
      return <ValueBox>{value === true ? 'true' : 'false'}</ValueBox>;
    case 'text':
    case 'select':
    case 'integer':
    case 'number':
    case 'date':
    case 'datetime':
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
    <div className="border-[0.5px] border-ink bg-paper px-4 py-3 font-sans text-[15px] leading-7 text-ink dark:bg-card dark:border-rule-on-dark dark:text-foreground">
      {children}
    </div>
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
    <figure className="border-[0.5px] border-ink bg-paper dark:border-rule-on-dark dark:bg-card">
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <img
          src={asset.publicUrl}
          alt={asset.altText ?? ''}
          className="size-full object-cover"
        />
        <span className="absolute right-2 bottom-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute bg-paper/85 px-1.5 py-0.5 dark:bg-card/85">
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
        console.warn('[cms-drawer] asset upload failed', err);
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
      <figure className="border-[0.5px] border-rule-soft bg-paper dark:border-rule-on-dark dark:bg-card">
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
            'group relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden border-[0.5px] border-dashed text-center transition',
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
                <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                  {uploading ? uploadingLabel : dragging ? activeLabel : replaceLabel}
                </span>
              </div>
            </>
          ) : (
            <span className="relative font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {uploading ? uploadingLabel : dragging ? activeLabel : hintLabel}
            </span>
          )}
          <span className="absolute right-2 bottom-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute bg-paper/85 px-1.5 py-0.5 dark:bg-card/85">
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

function computePatch(
  fields: CmsFieldDef[],
  initial: EditableData,
  edited: EditableData,
): EditableData {
  const patch: EditableData = {};
  for (const field of fields) {
    if (!fieldValuesEqual(field, initial[field.name], edited[field.name])) {
      patch[field.name] = serializeForPatch(field, edited[field.name]);
    }
  }
  return patch;
}

function fieldValuesEqual(field: CmsFieldDef, a: unknown, b: unknown): boolean {
  if (field.type === 'asset') return assetIdOf(a) === assetIdOf(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (a == null && b == null) return true;
  return a === b;
}

function serializeForPatch(field: CmsFieldDef, value: unknown): unknown {
  if (value == null) return null;
  if (field.type === 'asset') return assetIdOf(value);
  return value;
}

function assetIdOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asAsset(value: unknown): CmsAssetExpanded | null {
  if (!value || typeof value !== 'object') return null;
  return readAssetField({ v: value }, 'v');
}

function isEmpty(value: unknown): boolean {
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

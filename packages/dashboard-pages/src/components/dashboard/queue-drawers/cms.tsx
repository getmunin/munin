'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { useRelative } from '../../../lib/use-relative';
import {
  DrawerErrorState,
  DrawerFooter,
  DrawerHeader,
  DrawerLoadingState,
  Markdown,
  useCmdEnter,
} from './shared';
import { NativeSelect } from '../../native-select';
import { computePatch, defaultForField, seedBlock } from './cms-blocks';
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
  type CmsFieldDef,
} from './types';

type EditableData = Record<string, unknown>;

export function CmsQueueDrawer({
  item,
  detail,
  loadError,
  onRetry,
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
  loadError: string | undefined;
  onRetry: () => void;
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
  const blocked = pending || !detail;

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
      await onSchedule(at.toISOString());
      setSchedulerOpen(false);
      setScheduledAt('');
    } catch (err) {
      console.warn('[cms-drawer] schedule failed', err);
    }
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

      {detail ? (
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
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
            />
          ))}
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
            disabled: pending || !dirty,
          }}
          secondary={[{ label: t('cancel'), onClick: cancelEdit }]}
          shortcut={t('shortcutSave')}
        />
      ) : (
        <div className="border-t-[1px] border-rule-soft dark:border-rule-on-dark">
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
                    className="rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:border-rule-on-dark dark:bg-card dark:text-foreground"
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
              <Button variant="accent" size="sm" onClick={onApprove} disabled={blocked}>
                {t('cmsApprove')}
              </Button>
              <Button variant="outline" size="sm" onClick={onDismiss} disabled={blocked}>
                {t('cmsDismiss')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t('cmsMoreMenu')}
                      disabled={blocked}
                    />
                  }
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    disabled={blocked}
                    onClick={() => setEditing(true)}
                  >
                    {t('edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={blocked} onClick={openScheduler}>
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
    'w-full rounded-input border-[1px] bg-paper px-4 py-2 font-sans text-[15px] leading-7 outline-none focus-visible:ring-1 dark:bg-card dark:text-foreground',
    invalid
      ? 'border-destructive focus-visible:ring-destructive'
      : 'border-cobalt focus-visible:ring-cobalt',
  );
  const textareaClass = cn(
    'w-full resize-y rounded-input border-[1px] bg-paper px-4 py-3 font-sans text-[15px] leading-7 outline-none focus-visible:ring-1 dark:bg-card dark:text-foreground',
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
            'h-auto pl-4 py-2 text-[15px] leading-7',
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
          <Markdown>{asString(value)}</Markdown>
        </ValueBox>
      );
    case 'asset': {
      const asset = asAsset(value);
      if (!asset) return null;
      return <AssetFigure asset={asset} aspectLabel={aspectLabel} />;
    }
    case 'blocks':
      return <BlocksViewer field={field} value={value} aspectLabel={aspectLabel} />;
    case 'multi_select': {
      const items = Array.isArray(value) ? (value as unknown[]) : [];
      return <ValueBox>{items.map(scalarText).filter(Boolean).join(', ') || '—'}</ValueBox>;
    }
    case 'array':
      return <ArrayViewer field={field} value={value} aspectLabel={aspectLabel} />;
    case 'boolean':
      return <ValueBox>{value === true ? 'true' : 'false'}</ValueBox>;
    case 'date':
      return <ValueBox>{formatDateValue(value, false) || '—'}</ValueBox>;
    case 'datetime':
      return <ValueBox>{formatDateValue(value, true) || '—'}</ValueBox>;
    case 'text':
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
    <div className="border-[1px] border-ink bg-paper px-4 py-3 font-sans text-[15px] leading-7 text-ink dark:bg-card dark:border-rule-on-dark dark:text-foreground">
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
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
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
    <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute/80">{children}</p>
  );
}

function BlocksViewer({
  field,
  value,
  aspectLabel,
}: {
  field: CmsFieldDef;
  value: unknown;
  aspectLabel: string;
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
                  <FieldViewer field={pf} value={block.props[pf.name]} aspectLabel={aspectLabel} />
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
}: {
  field: CmsFieldDef;
  value: unknown;
  aspectLabel: string;
}) {
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  if (items.length === 0) return null;
  const itemDef = field.options?.items;
  if (itemDef?.type === 'asset') {
    return (
      <div className="space-y-2">
        {items.map((it, index) => (
          <FieldViewer key={index} field={itemDef} value={it} aspectLabel={aspectLabel} />
        ))}
      </div>
    );
  }
  return (
    <ValueBox>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((it, index) => (
          <li key={index}>{scalarText(it) || '—'}</li>
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

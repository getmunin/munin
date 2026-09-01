'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@getmunin/ui';
import { ConsoleHero } from '../components/console-hero';
import { api, ApiError } from '../api';
import { notify } from '../lib/notify';
import { useTranslateError } from '../i18n/translate-error';
import { useRealtime } from '../realtime';
import { LoadFailed } from '../components/load-failed';
import { useInboxLoadFailedProps } from '../lib/use-load-failed-props';

type TopicMode = 'auto' | 'draft_only' | 'off' | null;
type PolicyChoice = 'inherit' | 'off' | 'draft_only' | 'auto';

interface TopicAutomationRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  agentMode: TopicMode;
  autoPromotedAt: string | null;
  windowDays: number;
  weeklyVolume: number;
  reviewedCount: number;
  approvedUnedited: number;
  edited: number;
  rejected: number;
  autoSent: number;
  promoteThresholdPct: number;
}

interface AutomationSummary {
  windowDays: number;
  autoRate7d: number | null;
  topics: TopicAutomationRow[];
}

const GATE_CHOICES = [85, 90, 95, 98] as const;

const GRID =
  'md:grid md:grid-cols-[minmax(170px,1.3fr)_150px_minmax(140px,1fr)_260px] md:items-center md:gap-4';

const DESCRIPTION_MAX = 600;

function uneditedPct(row: TopicAutomationRow): number | null {
  if (row.reviewedCount === 0) return null;
  return Math.round((row.approvedUnedited / row.reviewedCount) * 100);
}

function policyOf(row: TopicAutomationRow): PolicyChoice {
  if (row.agentMode === null) return 'inherit';
  return row.agentMode === 'auto' ? 'auto' : row.agentMode === 'off' ? 'off' : 'draft_only';
}

function autoIsSending(row: TopicAutomationRow): boolean {
  const pct = uneditedPct(row);
  return policyOf(row) === 'auto' && pct !== null && pct >= row.promoteThresholdPct;
}

export function AutomationPage() {
  const t = useTranslations('dashboard.console.automation');
  const translateErr = useTranslateError();
  const buildLoadFailedProps = useInboxLoadFailedProps();
  const [summary, setSummary] = useState<AutomationSummary | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<TopicAutomationRow | null>(null);
  const [draftPolicy, setDraftPolicy] = useState<PolicyChoice>('draft_only');
  const [draftGate, setDraftGate] = useState<number>(90);
  const [draftDescription, setDraftDescription] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api<AutomationSummary>('/v1/conversations/automation');
      setSummary(res);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('conversation.')) void load();
  });

  const openEditor = useCallback((row: TopicAutomationRow) => {
    setEditing(row);
    setDraftPolicy(policyOf(row));
    setDraftGate(row.promoteThresholdPct);
    setDraftDescription(row.description ?? '');
  }, []);

  const savePolicy = useCallback(async () => {
    if (!editing) return;
    const policyChanged =
      draftPolicy !== policyOf(editing) || draftGate !== editing.promoteThresholdPct;
    const description = draftDescription.trim();
    const descriptionChanged = description !== (editing.description ?? '');
    setPending(true);
    try {
      if (descriptionChanged) {
        await api(`/v1/conversations/topics/${editing.id}`, {
          method: 'POST',
          body: JSON.stringify({ description: description.length > 0 ? description : null }),
        });
      }
      if (policyChanged) {
        await api(`/v1/conversations/topics/${editing.id}/agent-mode`, {
          method: 'POST',
          body: JSON.stringify({
            mode: draftPolicy === 'inherit' ? null : draftPolicy,
            promoteThresholdPct: draftGate,
          }),
        });
      }
      setEditing(null);
      await load();
      notify.success(
        policyChanged
          ? t(`saved_${draftPolicy}`, { name: editing.name, pct: draftGate })
          : t('savedDescription', { name: editing.name }),
      );
    } catch (err) {
      notify.error(translateErr(err));
    } finally {
      setPending(false);
    }
  }, [editing, draftPolicy, draftGate, draftDescription, load, t, translateErr]);

  const topics = useMemo(() => {
    const rows = summary?.topics ?? [];
    return [...rows].sort((a, b) => {
      const pa = uneditedPct(a);
      const pb = uneditedPct(b);
      if (pa === null && pb === null) return a.name.localeCompare(b.name);
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (pb !== pa) return pb - pa;
      return a.name.localeCompare(b.name);
    });
  }, [summary]);

  if (loadError && !summary) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12 md:px-10">
        <LoadFailed
          {...buildLoadFailedProps(
            loadError,
            () => {
              setRetrying(true);
              void load().finally(() => setRetrying(false));
            },
            retrying,
          )}
        />
      </div>
    );
  }

  const autoRate = summary?.autoRate7d;
  const editingPct = editing ? uneditedPct(editing) : null;
  const autoSending = editingPct !== null && editingPct >= draftGate;
  const unchanged =
    !!editing &&
    draftPolicy === policyOf(editing) &&
    draftGate === editing.promoteThresholdPct &&
    draftDescription.trim() === (editing.description ?? '');

  return (
    <div className="flex min-h-full flex-col">
      <ConsoleHero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('lede')}
        actions={
          <>
            <div className="font-serif text-6xl leading-none text-ink md:text-7xl dark:text-foreground">
              {autoRate === null || autoRate === undefined ? '—' : `${Math.round(autoRate * 100)}%`}
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('autoRateCaption')}
            </div>
          </>
        }
      />

      <div className="flex-1 px-5 pb-10 pt-1 md:overflow-x-auto md:px-8">
        <div className="md:min-w-[760px]">
          <div
            className={cn(
              GRID,
              'border-b border-ink py-3.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute max-md:hidden dark:border-rule-on-dark',
            )}
          >
            <span>{t('colTopic')}</span>
            <span>{t('colVolume')}</span>
            <span>{t('colUnedited')}</span>
            <span className="justify-self-end">{t('colPolicy')}</span>
          </div>
          {topics.length === 0 ? (
            <p className="py-6 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
              {t('empty')}
            </p>
          ) : null}
          {topics.map((row) => {
            const pct = uneditedPct(row);
            const policy = policyOf(row);
            const clears = pct !== null && pct >= row.promoteThresholdPct;
            const armedButHolding = policy === 'auto' && !clears;
            const sending = autoIsSending(row);
            return (
              <div
                key={row.id}
                className={cn(
                  GRID,
                  'border-b border-rule-soft py-4 max-md:flex max-md:flex-col max-md:gap-2.5 dark:border-rule-on-dark',
                )}
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-ink dark:text-foreground">
                    {row.name}
                  </span>
                  {row.description ? (
                    <span className="line-clamp-2 text-[11.5px] leading-snug text-ink-soft dark:text-foreground/70">
                      {row.description}
                    </span>
                  ) : null}
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] text-ink-soft max-md:hidden dark:text-foreground/80">
                  {t('volumeWindow', { count: row.weeklyVolume, n: row.reviewedCount })}
                </span>
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'min-w-[52px] font-serif text-xl italic',
                      clears ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-soft dark:text-foreground/80',
                    )}
                  >
                    {pct === null ? '—' : `${pct}%`}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute md:hidden">
                    {t('colUnedited')}
                  </span>
                  <span className="relative h-1 max-w-[120px] flex-1 bg-rule-soft max-md:hidden dark:bg-rule-on-dark">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0',
                        clears ? 'bg-cobalt dark:bg-cobalt-soft' : 'bg-ink-soft dark:bg-foreground/60',
                      )}
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </span>
                </span>
                <span className="flex items-center justify-end gap-3.5 max-md:justify-between">
                  <span
                    className={cn(
                      'font-mono text-[9.5px] uppercase tracking-meta md:text-right',
                      sending
                        ? 'text-cobalt dark:text-cobalt-soft'
                        : armedButHolding
                          ? 'text-ink-mute'
                          : 'text-ink dark:text-foreground',
                    )}
                  >
                    {policy === 'auto'
                      ? sending
                        ? t('policyAutoSending', { pct: row.promoteThresholdPct })
                        : t('policyAutoHolding', { pct: row.promoteThresholdPct })
                      : policy === 'off'
                        ? t('modeOff')
                        : policy === 'inherit'
                          ? t('modeInherit')
                          : t('modeDraft')}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => openEditor(row)}
                  >
                    {t('edit')}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          {editing ? (
            <>
              <DialogHeader>
                <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
                  {t('policyFor', { name: editing.name })}
                </div>
                <DialogTitle className="font-serif text-3xl font-normal leading-[1.05] tracking-tight">
                  {t.rich('dialogTitle', {
                    em: (chunks) => (
                      <em className="italic text-cobalt dark:text-cobalt-soft">{chunks}</em>
                    ),
                  })}
                </DialogTitle>
                <div className="font-mono text-[10px] uppercase tracking-meta text-ink-mute">
                  {t('dialogStats', {
                    pct: editingPct ?? 0,
                    n: editing.reviewedCount,
                    vol: editing.weeklyVolume,
                  })}
                </div>
              </DialogHeader>

              <div className="mb-5">
                <label
                  htmlFor="topic-description"
                  className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute"
                >
                  {t('descriptionLabel')}
                </label>
                <textarea
                  id="topic-description"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={3}
                  maxLength={DESCRIPTION_MAX}
                  placeholder={t('descriptionPlaceholder')}
                  className="mt-2 w-full rounded-input border-[1px] border-rule-soft bg-paper px-3 py-2 text-base leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt md:text-sm dark:border-rule-on-dark dark:bg-card"
                />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-soft dark:text-foreground/70">
                  {t('descriptionHelp')}
                </p>
              </div>

              <div className="flex flex-col border border-rule-soft dark:border-rule-on-dark">
                {(
                  [
                    ['inherit', t('modeInherit'), t('modeInheritBody')],
                    ['off', t('modeOff'), t('modeOffBody')],
                    ['draft_only', t('modeDraft'), t('modeDraftBody')],
                    ['auto', t('modeAuto'), t('modeAutoBody')],
                  ] as const
                ).map(([choice, label, body], i) => {
                  const on = draftPolicy === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setDraftPolicy(choice)}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-fast ease-munin hover:bg-paper-deep dark:hover:bg-secondary',
                        i < 3 && 'border-b border-rule-soft dark:border-rule-on-dark',
                        on && 'bg-cobalt/[0.06]',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'size-[9px] shrink-0 rounded-full border',
                          on
                            ? 'border-cobalt bg-cobalt dark:border-cobalt-soft dark:bg-cobalt-soft'
                            : 'border-ink-mute bg-transparent',
                        )}
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span
                          className={cn(
                            'font-mono text-[11px] uppercase tracking-meta',
                            on ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink dark:text-foreground',
                          )}
                        >
                          {label}
                        </span>
                        <span className="text-[12.5px] leading-relaxed text-ink-soft dark:text-foreground/80">
                          {body}
                        </span>
                        {choice === 'auto' ? (
                          <span
                            className={cn(
                              'font-mono text-[9px] uppercase tracking-meta',
                              autoSending ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
                            )}
                          >
                            {editingPct === null
                              ? t('autoNoData', { gate: draftGate })
                              : autoSending
                                ? t('autoSendingNow', { pct: editingPct })
                                : t('autoDraftingUntil', { pct: editingPct, gate: draftGate })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              {draftPolicy === 'auto' ? (
                <div className="mt-4 border-t border-rule-soft pt-4 dark:border-rule-on-dark">
                  <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
                    {t('gateLabel')}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-3.5">
                    <div className="flex border border-rule-soft dark:border-rule-on-dark">
                      {GATE_CHOICES.map((gate) => (
                        <button
                          key={gate}
                          type="button"
                          onClick={() => setDraftGate(gate)}
                          className={cn(
                            'whitespace-nowrap px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-meta transition-colors duration-fast ease-munin',
                            draftGate === gate
                              ? 'bg-ink text-paper dark:bg-foreground dark:text-background'
                              : 'text-ink-mute hover:bg-paper-deep dark:hover:bg-secondary',
                          )}
                        >
                          {`≥${gate}%`}
                        </button>
                      ))}
                    </div>
                    <span className="max-w-[26ch] text-xs leading-relaxed text-ink-soft dark:text-foreground/80">
                      {t('gateHelp')}
                    </span>
                  </div>
                </div>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  disabled={pending || unchanged}
                  pending={pending}
                  onClick={() => void savePolicy()}
                >
                  {t('savePolicy')} <span aria-hidden>→</span>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

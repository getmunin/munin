'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
  cn,
} from '@getmunin/ui';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { FormError, toFormError, type FormErrorDetail } from './form-error';
import { dialogFooterClass } from '../lib/dialog-style';

export interface ChannelSources {
  channelId: string;
  kbSpaces: Array<{ id: string; slug: string; name: string }>;
  connections: Array<{ id: string; name: string; vendor: string; domain: string }>;
}

interface SpaceOption {
  id: string;
  slug: string;
  name: string;
}

interface ConnectionOption {
  id: string;
  name: string;
  vendor: string;
  domain: string;
  active: boolean;
}

const BINDABLE_DOMAINS = ['commerce', 'bookings'] as const;
type BindableDomain = (typeof BINDABLE_DOMAINS)[number];
type PinnedConnections = Record<BindableDomain, string>;

const HIDDEN_SPACE_SLUGS = new Set(['agent-runtime', 'kb-curation-inbox']);

export type ChannelDialogTab = 'channel' | 'knowledge';

export interface ChannelKnowledge {
  spaces: SpaceOption[] | null;
  connections: ConnectionOption[] | null;
  loadError: string | null;
  limited: boolean;
  setLimited: (next: boolean) => void;
  selected: ReadonlySet<string>;
  toggleSpace: (id: string) => void;
  pinned: PinnedConnections;
  pin: (domain: BindableDomain, id: string) => void;
  restricted: Record<BindableDomain, boolean>;
  setRestricted: (domain: BindableDomain, next: boolean) => void;
  dirty: boolean;
  commit: (channelId: string) => Promise<FormErrorDetail | null>;
}

function pinnedFrom(initial: ChannelSources | undefined): PinnedConnections {
  return {
    commerce: initial?.connections.find((c) => c.domain === 'commerce')?.id ?? '',
    bookings: initial?.connections.find((c) => c.domain === 'bookings')?.id ?? '',
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function useChannelKnowledge(
  open: boolean,
  initial: ChannelSources | undefined,
): ChannelKnowledge {
  const t = useTranslations('dashboard.channels.knowledge');
  const translate = useTranslateError();
  const [spaces, setSpaces] = useState<SpaceOption[] | null>(null);
  const [connections, setConnections] = useState<ConnectionOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pinned, setPinned] = useState<PinnedConnections>(() => pinnedFrom(undefined));
  const [restricted, setRestrictedState] = useState<Record<BindableDomain, boolean>>({
    commerce: false,
    bookings: false,
  });

  useEffect(() => {
    if (!open) return;
    setLimited((initial?.kbSpaces.length ?? 0) > 0);
    setSelected(new Set(initial?.kbSpaces.map((s) => s.id) ?? []));
    const initialPins = pinnedFrom(initial);
    setPinned(initialPins);
    setRestrictedState({
      commerce: initialPins.commerce !== '',
      bookings: initialPins.bookings !== '',
    });
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadError(null);
    void Promise.all([
      api<SpaceOption[]>('/v1/kb/spaces'),
      api<{ connections: ConnectionOption[] }>('/v1/connectors'),
    ])
      .then(([spaceList, { connections: connectionList }]) => {
        if (!active) return;
        setSpaces(spaceList);
        setConnections(connectionList);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(translate(err) || t('loadFailed'));
      });
    return () => {
      active = false;
    };
  }, [open, translate, t]);

  const toggleSpace = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pin = useCallback((domain: BindableDomain, id: string) => {
    setPinned((prev) => ({ ...prev, [domain]: id }));
  }, []);

  const setRestricted = useCallback(
    (domain: BindableDomain, next: boolean) => {
      setRestrictedState((prev) => ({ ...prev, [domain]: next }));
      const options = (connections ?? []).filter((c) => c.domain === domain);
      setPinned((prev) => ({
        ...prev,
        [domain]: next ? (prev[domain] || (options.length === 1 ? options[0]!.id : '')) : '',
      }));
    },
    [connections],
  );

  const kbSpaceIds = limited ? [...selected] : [];
  const connectionIds = BINDABLE_DOMAINS.map((d) => pinned[d]).filter(Boolean);
  const dirty =
    !sameIds(kbSpaceIds, initial?.kbSpaces.map((s) => s.id) ?? []) ||
    !sameIds(connectionIds, initial?.connections.map((c) => c.id) ?? []);

  async function commit(channelId: string): Promise<FormErrorDetail | null> {
    if (!dirty) return null;
    try {
      await api<ChannelSources>(`/v1/conversations/channels/${channelId}/sources`, {
        method: 'PUT',
        body: JSON.stringify({ kbSpaceIds, connectionIds }),
      });
      return null;
    } catch (err) {
      return toFormError(err, translate(err) || t('saveFailed'));
    }
  }

  return {
    spaces,
    connections,
    loadError,
    limited,
    setLimited,
    selected,
    toggleSpace,
    pinned,
    pin,
    restricted,
    setRestricted,
    dirty,
    commit,
  };
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V | null;
  onChange: (next: V) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex border-[1px] border-ink dark:border-foreground', className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 whitespace-nowrap border-l-[1px] border-ink px-3 py-1.5 text-center text-[13px] transition-colors first:border-l-0 dark:border-foreground',
              selected
                ? 'bg-ink text-paper dark:bg-foreground dark:text-card'
                : 'text-ink hover:bg-ink/5 dark:text-foreground dark:hover:bg-foreground/10',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChannelKnowledgePanel({
  knowledge,
  channelName,
}: {
  knowledge: ChannelKnowledge;
  channelName: string;
}) {
  const t = useTranslations('dashboard.channels.knowledge');
  const name = channelName.trim();

  if (knowledge.loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {knowledge.loadError}
      </p>
    );
  }
  if (knowledge.spaces === null || knowledge.connections === null) {
    return <p className="text-[13px] text-ink-mute">{t('loading')}</p>;
  }

  const visibleSpaces = knowledge.spaces.filter(
    (s) => !HIDDEN_SPACE_SLUGS.has(s.slug) || knowledge.selected.has(s.id),
  );
  const allNames = knowledge.spaces
    .filter((s) => !HIDDEN_SPACE_SLUGS.has(s.slug))
    .map((s) => s.name);
  const shownDomains = BINDABLE_DOMAINS.filter(
    (d) => knowledge.pinned[d] !== '' || (knowledge.connections ?? []).some((c) => c.domain === d),
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-[1.5] text-ink-soft dark:text-foreground/70">
        {name ? t('lede', { name }) : t('ledeNew')}
      </p>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold text-ink dark:text-foreground">
            {t('spacesLabel')}
          </span>
          <Segmented
            label={t('spacesLabel')}
            options={[
              { value: 'all', label: t('allSpaces') },
              { value: 'some', label: t('onlyThese') },
            ]}
            value={knowledge.limited ? 'some' : 'all'}
            onChange={(next) => knowledge.setLimited(next === 'some')}
          />
        </div>
        {visibleSpaces.length === 0 ? (
          <p className="text-[13px] leading-[1.5] text-ink-mute">{t('spacesEmpty')}</p>
        ) : knowledge.limited ? (
          <>
            <div className="max-h-56 overflow-y-auto border-[1px] border-rule-soft dark:border-rule-on-dark">
              {visibleSpaces.map((space) => (
                <label
                  key={space.id}
                  className="flex cursor-pointer items-center gap-3 border-b-[1px] border-rule-soft px-3.5 py-2.5 last:border-0 dark:border-rule-on-dark"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-ink dark:accent-foreground"
                    checked={knowledge.selected.has(space.id)}
                    onChange={() => knowledge.toggleSpace(space.id)}
                  />
                  <span className="flex-1 text-sm text-ink dark:text-foreground">{space.name}</span>
                  <span className="font-mono text-[12px] text-ink-mute">{space.slug}</span>
                </label>
              ))}
            </div>
            {knowledge.selected.size === 0 && (
              <p className="text-[13px] leading-[1.5] text-ink-mute">{t('noneTicked')}</p>
            )}
          </>
        ) : (
          <p className="text-[13px] leading-[1.5] text-ink-mute">
            {t('allSpacesHint', { names: allNames.join(', ') })}
          </p>
        )}
      </div>

      {shownDomains.length > 0 && <div className="h-px bg-rule-soft dark:bg-rule-on-dark" />}

      {shownDomains.map((domain) => (
        <ConnectionPicker key={domain} knowledge={knowledge} domain={domain} />
      ))}
    </div>
  );
}

function ConnectionPicker({
  knowledge,
  domain,
}: {
  knowledge: ChannelKnowledge;
  domain: BindableDomain;
}) {
  const t = useTranslations('dashboard.channels.knowledge');
  const name = useId();
  const options = (knowledge.connections ?? []).filter((c) => c.domain === domain);
  const value = knowledge.pinned[domain];
  const restricted = knowledge.restricted[domain];
  const missing = value !== '' && !options.some((c) => c.id === value);
  const rows: Array<{ id: string; label: string; meta?: string; disabled?: boolean }> = [
    ...options.map((c) => ({
      id: c.id,
      label: c.active ? c.name : t('inactiveOption', { name: c.name }),
      meta: c.vendor,
    })),
    ...(missing ? [{ id: value, label: t('missingOption'), disabled: true }] : []),
  ];
  const label = t(`domain.${domain}`);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-ink dark:text-foreground">{label}</div>
          <div className="mt-0.5 text-[13px] text-ink-mute">{t(`domainHint.${domain}`)}</div>
        </div>
        <Segmented
          label={label}
          options={[
            { value: 'all', label: t('allConnections') },
            { value: 'one', label: t('onlyThis') },
          ]}
          value={restricted ? 'one' : 'all'}
          onChange={(next) => knowledge.setRestricted(domain, next === 'one')}
        />
      </div>
      {restricted ? (
        <>
          <div
            role="radiogroup"
            aria-label={label}
            className="border-[1px] border-rule-soft dark:border-rule-on-dark"
          >
            {rows.map((row) => (
              <label
                key={row.id}
                className={cn(
                  'flex items-center gap-3 border-b-[1px] border-rule-soft px-3.5 py-2.5 last:border-0 dark:border-rule-on-dark',
                  row.disabled ? 'cursor-default' : 'cursor-pointer',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="size-4 shrink-0 accent-ink dark:accent-foreground"
                  checked={value === row.id}
                  disabled={row.disabled}
                  onChange={() => knowledge.pin(domain, row.id)}
                />
                <span
                  className={cn(
                    'flex-1 text-sm',
                    row.disabled ? 'text-ink-mute' : 'text-ink dark:text-foreground',
                  )}
                >
                  {row.label}
                </span>
                {row.meta ? (
                  <span className="font-mono text-[12px] text-ink-mute">{row.meta}</span>
                ) : null}
              </label>
            ))}
          </div>
          {value === '' && (
            <p className="text-[13px] leading-[1.5] text-ink-mute">{t('noneSelected')}</p>
          )}
        </>
      ) : (
        <p className="text-[13px] leading-[1.5] text-ink-mute">
          {t('allConnectionsHint', { names: options.map((c) => c.name).join(', ') })}
        </p>
      )}
    </div>
  );
}

export function ChannelDialogShell({
  eyebrow,
  title,
  description,
  tab,
  onTabChange,
  knowledge,
  channelName,
  onSubmit,
  channelPanel,
  submitError,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  tab: ChannelDialogTab;
  onTabChange: (next: ChannelDialogTab) => void;
  knowledge: ChannelKnowledge;
  channelName: string;
  onSubmit: () => void;
  channelPanel: ReactNode;
  submitError: FormErrorDetail | null;
  actions: ReactNode;
}) {
  const t = useTranslations('dashboard.channels.knowledge');
  const formRef = useRef<HTMLFormElement>(null);
  const tabClass =
    'items-baseline gap-2 px-0 pt-0 pb-2.5 font-sans text-sm font-normal normal-case tracking-normal text-ink-mute data-[active]:border-ink dark:data-[active]:border-foreground';

  return (
    <Tabs
      value={tab}
      onValueChange={(next: ChannelDialogTab) => onTabChange(next)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader className="mb-0 gap-1.5 pb-0">
        <p className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">{eyebrow}</p>
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <p className="text-sm text-ink-mute">{description}</p>
        ) : null}
        <TabsList className="mt-3 flex gap-6 border-b-0">
          <TabsTrigger value="channel" className={tabClass}>
            {t('tabChannel')}
          </TabsTrigger>
          <TabsTrigger value="knowledge" className={tabClass}>
            {t('tabKnowledge')}
          </TabsTrigger>
        </TabsList>
      </DialogHeader>
      <form
        ref={formRef}
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        onInvalidCapture={() => {
          if (tab === 'channel') return;
          onTabChange('channel');
          requestAnimationFrame(() => formRef.current?.reportValidity());
        }}
      >
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <TabsPanel value="channel" keepMounted className="mt-0 focus-visible:ring-0">
            {channelPanel}
          </TabsPanel>
          <TabsPanel value="knowledge" keepMounted className="mt-0 pt-6 focus-visible:ring-0">
            <ChannelKnowledgePanel knowledge={knowledge} channelName={channelName} />
          </TabsPanel>
        </div>
        {submitError && <FormError detail={submitError} pinned />}
        <DialogFooter className={cn(dialogFooterClass, submitError && 'mt-0')}>
          {actions}
        </DialogFooter>
      </form>
    </Tabs>
  );
}

export function channelSourcesSummary(
  sources: ChannelSources | undefined,
): { spaces: string | null; connections: string | null } {
  return {
    spaces: sources?.kbSpaces.length ? sources.kbSpaces.map((s) => s.name).join(', ') : null,
    connections: sources?.connections.length
      ? sources.connections.map((c) => c.name).join(', ')
      : null,
  };
}

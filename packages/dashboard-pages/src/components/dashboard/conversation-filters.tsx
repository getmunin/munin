'use client';

import { Funnel, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { NativeSelect } from '../native-select';
import {
  DEFAULT_QUEUE_FILTERS,
  QUEUE_CHANNEL_FILTERS,
  QUEUE_ORIGIN_FILTERS,
  QUEUE_SINCE_FILTERS,
  QUEUE_STATUS_FILTERS,
  activeQueueFilterCount,
  type QueueChannelFilter,
  type QueueFilters,
  type QueueOriginFilter,
  type QueueSinceFilter,
  type QueueStatusFilter,
} from './conversation-queue';

export interface TopicOption {
  id: string;
  name: string;
}

const LABEL_CLASS =
  'font-mono text-[10px] font-medium uppercase tracking-meta text-ink-label';
const FIELD_CLASS = 'h-10 w-full text-sm';
const MONO_ACTION_CLASS =
  'shrink-0 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute transition-colors duration-fast hover:text-ink dark:hover:text-foreground';

export function ConversationFiltersTrigger({
  filters,
  open,
  onToggle,
}: {
  filters: QueueFilters;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('dashboard.console.queue.filters');
  const highlight = open || activeQueueFilterCount(filters) > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t('label')}
      title={t('label')}
      className={cn(
        'flex aspect-square shrink-0 items-center justify-center rounded-input border transition-colors duration-fast',
        highlight
          ? 'border-cobalt text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft'
          : 'border-rule-soft text-ink-mute hover:text-ink dark:border-rule-on-dark dark:hover:text-foreground',
      )}
    >
      <Funnel aria-hidden className="size-4" />
    </button>
  );
}

export function ConversationFiltersReceipt({
  filters,
  topics,
  onChange,
  onClear,
}: {
  filters: QueueFilters;
  topics: TopicOption[];
  onChange: (next: QueueFilters) => void;
  onClear: () => void;
}) {
  const t = useTranslations('dashboard.console.queue.filters');
  const tokens: Array<{ key: keyof QueueFilters; dimension: string; value: string }> = [];

  if (filters.status !== 'any') {
    tokens.push({
      key: 'status',
      dimension: t('status'),
      value: t(`statusOption.${filters.status}`),
    });
  }
  if (filters.origin !== 'any') {
    tokens.push({
      key: 'origin',
      dimension: t('origin'),
      value: t(`originOption.${filters.origin}`),
    });
  }
  if (filters.channelType !== 'any') {
    tokens.push({
      key: 'channelType',
      dimension: t('channel'),
      value: t(`channelOption.${filters.channelType}`),
    });
  }
  if (filters.since !== 'any') {
    tokens.push({
      key: 'since',
      dimension: t('since'),
      value: t(`sinceOption.${filters.since}`),
    });
  }
  if (filters.topicId !== 'any') {
    tokens.push({
      key: 'topicId',
      dimension: t('topic'),
      value: topics.find((topic) => topic.id === filters.topicId)?.name ?? filters.topicId,
    });
  }

  if (tokens.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-mute">
        {t('showing')}
      </span>
      {tokens.map((token) => (
        <span
          key={token.key}
          className="inline-flex items-center gap-2 bg-ink px-2.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-meta text-paper dark:bg-foreground dark:text-background"
        >
          {token.dimension} · {token.value}
          <button
            type="button"
            onClick={() => onChange({ ...filters, [token.key]: DEFAULT_QUEUE_FILTERS[token.key] })}
            aria-label={t('removeFilter', { dimension: token.dimension })}
            className="-mr-0.5 opacity-70 transition-opacity duration-fast hover:opacity-100"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className={MONO_ACTION_CLASS}>
        {t('clearAll')}
      </button>
    </div>
  );
}

export function ConversationFiltersPanel({
  filters,
  topics,
  onChange,
}: {
  filters: QueueFilters;
  topics: TopicOption[];
  onChange: (next: QueueFilters) => void;
}) {
  const t = useTranslations('dashboard.console.queue.filters');
  const set = <K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="shrink-0 border-b border-ink bg-paper-deep px-5 py-4 dark:border-rule-on-dark dark:bg-secondary">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>{t('status')}</span>
          <NativeSelect
            className={FIELD_CLASS}
            value={filters.status}
            onChange={(e) => set('status', e.target.value as QueueStatusFilter)}
          >
            {QUEUE_STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`statusOption.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>{t('origin')}</span>
          <NativeSelect
            className={FIELD_CLASS}
            value={filters.origin}
            onChange={(e) => set('origin', e.target.value as QueueOriginFilter)}
          >
            {QUEUE_ORIGIN_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`originOption.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>{t('channel')}</span>
          <NativeSelect
            className={FIELD_CLASS}
            value={filters.channelType}
            onChange={(e) => set('channelType', e.target.value as QueueChannelFilter)}
          >
            {QUEUE_CHANNEL_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`channelOption.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>{t('since')}</span>
          <NativeSelect
            className={FIELD_CLASS}
            value={filters.since}
            onChange={(e) => set('since', e.target.value as QueueSinceFilter)}
          >
            {QUEUE_SINCE_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`sinceOption.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </label>

        {topics.length > 0 ? (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={LABEL_CLASS}>{t('topic')}</span>
            <NativeSelect
              className={FIELD_CLASS}
              value={filters.topicId}
              onChange={(e) => set('topicId', e.target.value)}
            >
              <option value="any">{t('topicOption.any')}</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
      </div>
    </div>
  );
}

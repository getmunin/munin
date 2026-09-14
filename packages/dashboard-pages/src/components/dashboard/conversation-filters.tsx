'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { NativeSelect } from '../native-select';
import {
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

const FIELD_CLASS = 'h-9 w-full text-[12.5px]';

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
  const count = activeQueueFilterCount(filters);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'flex h-[38px] shrink-0 items-center gap-1.5 rounded-input border px-2.5 font-mono text-[10px] font-medium uppercase tracking-meta transition-colors duration-fast md:h-[30px]',
        count > 0 || open
          ? 'border-cobalt text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft'
          : 'border-rule-soft text-ink-mute hover:text-ink dark:border-rule-on-dark dark:hover:text-foreground',
      )}
    >
      <SlidersHorizontal aria-hidden className="size-3.5" />
      {t('label')}
      {count > 0 ? <span aria-hidden>({count})</span> : null}
      <span className="sr-only">{t('activeCount', { count })}</span>
    </button>
  );
}

export function ConversationFiltersPanel({
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
  const set = <K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-rule-soft pt-2.5 dark:border-rule-on-dark">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-label">
          {t('status')}
        </span>
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

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-label">
          {t('origin')}
        </span>
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

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-label">
          {t('channel')}
        </span>
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

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-label">
          {t('since')}
        </span>
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
        <label className="col-span-2 flex flex-col gap-1">
          <span className="font-mono text-[10px] font-medium uppercase tracking-meta text-ink-label">
            {t('topic')}
          </span>
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

      {activeQueueFilterCount(filters) > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="col-span-2 justify-self-start font-mono text-[10px] font-medium uppercase tracking-meta text-ink-soft underline underline-offset-[3px] transition-colors duration-fast hover:text-ink dark:text-foreground/70 dark:hover:text-foreground"
        >
          {t('clear')}
        </button>
      ) : null}
    </div>
  );
}

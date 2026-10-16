'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { PageSpinner, Pill } from '@getmunin/ui';
import { api } from '../../api';
import { PaneHeader, ScheduledFooter, ScheduledNotice } from './queue-panes/shared';
import { BroadcastEmailPreview } from './broadcast-email-preview';
import type { BroadcastDetailDto, BroadcastSummaryDto } from './queue-panes/types';

export function ScheduledBroadcastPane({
  broadcast,
  at,
  pending,
  onCancel,
  hideHeaderOnMobile,
}: {
  broadcast: BroadcastSummaryDto;
  at: string;
  pending: boolean;
  onCancel: () => void;
  hideHeaderOnMobile?: boolean;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const tBroadcast = useTranslations('dashboard.console.review.broadcast');
  const format = useFormatter();
  const [detail, setDetail] = useState<BroadcastDetailDto | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api<BroadcastDetailDto>(`/v1/outreach/broadcasts/${broadcast.id}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [broadcast.id]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const count = broadcast.approvedAudienceCount ?? 0;
  const when = format.dateTime(new Date(at), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      <PaneHeader
        kind="broadcast"
        pillLabel={tQueue('kindBroadcast')}
        title={broadcast.subject}
        meta={t('metaBroadcast', { name: broadcast.name, count })}
        rightExtra={<Pill tone="review">{t('scheduledPill')}</Pill>}
        closeLabel={t('close')}
        className={hideHeaderOnMobile ? 'max-md:hidden' : undefined}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-7">
        <ScheduledNotice
          headline={t('scheduledBroadcastHeadline', { when })}
          detail={t('scheduledBroadcastDetail', { count })}
        />

        {detail?.preview.html ? (
          <BroadcastEmailPreview
            html={detail.preview.html}
            text={detail.preview.text}
            recipientName={detail.preview.recipient.name ?? detail.preview.recipient.address}
          />
        ) : failed ? (
          <p className="text-[13px] text-ink-mute">{tBroadcast('loadFailed')}</p>
        ) : (
          <div className="flex min-h-[160px] items-center justify-center">
            <PageSpinner />
          </div>
        )}
      </div>

      <ScheduledFooter
        cancelLabel={t('scheduledBroadcastCancel')}
        onCancel={onCancel}
        disabled={pending}
        note={t('scheduledNote')}
      />
    </>
  );
}

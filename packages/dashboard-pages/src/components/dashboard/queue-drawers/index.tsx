'use client';

import { CmsQueueDrawer } from './cms';
import { CrmQueueDrawer } from './crm';
import { FeedbackQueueDrawer } from './feedback';
import { KbQueueDrawer } from './kb';
import { OutreachQueueDrawer } from './outreach';
import type { CmsDraftDetailDto, QueueItem } from './types';

export function QueueDrawer({
  item,
  kbBody,
  cmsDetail,
  pending,
  onApprove,
  onDismiss,
  onSave,
  onSchedule,
  onClose,
}: {
  item: QueueItem;
  kbBody?: string;
  cmsDetail?: CmsDraftDetailDto;
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onSchedule: (scheduledAt: string) => Promise<void>;
  onClose: () => void;
}) {
  switch (item.kind) {
    case 'kb':
      return (
        <KbQueueDrawer
          item={item}
          body={kbBody}
          pending={pending}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onSave={onSave}
          onClose={onClose}
        />
      );
    case 'crm':
      return (
        <CrmQueueDrawer
          item={item}
          pending={pending}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onClose={onClose}
        />
      );
    case 'outreach':
      return (
        <OutreachQueueDrawer
          item={item}
          pending={pending}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onSave={onSave}
          onClose={onClose}
        />
      );
    case 'feedback':
      return (
        <FeedbackQueueDrawer
          item={item}
          pending={pending}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onClose={onClose}
        />
      );
    case 'cms':
      return (
        <CmsQueueDrawer
          item={item}
          detail={cmsDetail}
          pending={pending}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onSave={onSave}
          onSchedule={onSchedule}
          onClose={onClose}
        />
      );
  }
}

export type { QueueItem } from './types';

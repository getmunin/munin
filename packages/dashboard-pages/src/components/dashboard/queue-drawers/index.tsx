'use client';

import { CmsQueueDrawer } from './cms';
import { CrmQueueDrawer } from './crm';
import { FeedbackQueueDrawer } from './feedback';
import { KbQueueDrawer } from './kb';
import { OutreachQueueDrawer } from './outreach';
import type {
  CmsAssetExpanded,
  CmsDraftDetailDto,
  CmsPreviewLink,
  QueueItem,
  ScheduledItem,
} from './types';

const noop = () => {};
const noopAsync = async () => {};

export function ScheduledDrawer({
  item,
  cmsDetail,
  loadError,
  onRetry,
  pending,
  onCancel,
  onClose,
}: {
  item: ScheduledItem;
  cmsDetail?: CmsDraftDetailDto;
  loadError?: string;
  onRetry: () => void;
  pending: boolean;
  onCancel: () => void;
  onClose?: () => void;
}) {
  if (item.kind === 'outreach') {
    return (
      <OutreachQueueDrawer
        item={{ ...item, createdAt: item.raw.createdAt }}
        pending={pending}
        readOnly
        onApprove={noop}
        onDismiss={noop}
        onSave={noopAsync}
        onCancelScheduled={onCancel}
        onClose={onClose}
      />
    );
  }
  return (
    <CmsQueueDrawer
      item={{ ...item, createdAt: item.raw.updatedAt }}
      detail={cmsDetail}
      loadError={loadError}
      onRetry={onRetry}
      pending={pending}
      readOnly
      scheduledAt={item.at}
      onApprove={noop}
      onDismiss={noop}
      onSaveData={noopAsync}
      onUploadAsset={() => Promise.reject(new Error('read-only'))}
      onSchedule={noopAsync}
      onCancelScheduled={onCancel}
      onClose={onClose}
    />
  );
}

export function QueueDrawer({
  item,
  kbBody,
  kbRevisedBody,
  cmsDetail,
  loadError,
  onRetry,
  pending,
  onApprove,
  onDismiss,
  onSave,
  onSaveCmsDraft,
  onUploadCmsAsset,
  onSchedule,
  previewLink,
  onRetryPreview,
  hideHeaderOnMobile,
  onClose,
}: {
  item: QueueItem;
  kbBody?: string;
  kbRevisedBody?: string;
  cmsDetail?: CmsDraftDetailDto;
  loadError?: string;
  onRetry: () => void;
  pending: boolean;
  onApprove: (sendAt?: string | null) => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onSaveCmsDraft: (data: Record<string, unknown>) => Promise<void>;
  onUploadCmsAsset: (file: File) => Promise<CmsAssetExpanded>;
  onSchedule: (scheduledAt: string) => Promise<void>;
  previewLink?: CmsPreviewLink;
  onRetryPreview?: () => void;
  hideHeaderOnMobile?: boolean;
  onClose?: () => void;
}) {
  switch (item.kind) {
    case 'kb':
      return (
        <KbQueueDrawer
          item={item}
          body={kbBody}
          revisedBody={kbRevisedBody}
          loadError={loadError}
          onRetry={onRetry}
          pending={pending}
          onApprove={() => onApprove()}
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
          onApprove={() => onApprove()}
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
          onApprove={() => onApprove()}
          onDismiss={onDismiss}
          onClose={onClose}
        />
      );
    case 'cms':
      return (
        <CmsQueueDrawer
          item={item}
          detail={cmsDetail}
          loadError={loadError}
          onRetry={onRetry}
          pending={pending}
          onApprove={() => onApprove()}
          onDismiss={onDismiss}
          onSaveData={onSaveCmsDraft}
          onUploadAsset={onUploadCmsAsset}
          onSchedule={onSchedule}
          previewLink={previewLink}
          onRetryPreview={onRetryPreview}
          hideHeaderOnMobile={hideHeaderOnMobile}
          onClose={onClose}
        />
      );
  }
}

export type { QueueItem, ScheduledItem } from './types';

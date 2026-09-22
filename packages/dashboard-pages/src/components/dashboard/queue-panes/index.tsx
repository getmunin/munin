'use client';

import { CmsQueuePane } from './cms';
import { CrmQueuePane } from './crm';
import { FeedbackQueuePane } from './feedback';
import { KbQueuePane } from './kb';
import { OutreachQueuePane } from './outreach';
import { SocialQueuePane } from './social';
import type { QueueActionError } from '../inbox-types';
import type {
  CmsAssetExpanded,
  CmsDraftDetailDto,
  CmsPreviewLink,
  QueueItem,
  ScheduledItem,
  SocialDraftEdit,
} from './types';

const noop = () => {};
const noopAsync = async () => {};

export function ScheduledItemPane({
  item,
  cmsDetail,
  loadError,
  onRetry,
  pending,
  onCancel,
  hideHeaderOnMobile,
  onClose,
}: {
  item: ScheduledItem;
  cmsDetail?: CmsDraftDetailDto;
  loadError?: string;
  onRetry: () => void;
  pending: boolean;
  onCancel: () => void;
  hideHeaderOnMobile?: boolean;
  onClose?: () => void;
}) {
  if (item.kind === 'outreach') {
    return (
      <OutreachQueuePane
        item={{ ...item, createdAt: item.raw.createdAt }}
        pending={pending}
        readOnly
        onApprove={noop}
        onDismiss={noop}
        onSave={noopAsync}
        onCancelScheduled={onCancel}
        hideHeaderOnMobile={hideHeaderOnMobile}
        onClose={onClose}
      />
    );
  }
  return (
    <CmsQueuePane
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
      hideHeaderOnMobile={hideHeaderOnMobile}
      onClose={onClose}
    />
  );
}

export function QueueItemPane({
  item,
  kbBody,
  kbRevisedBody,
  cmsDetail,
  loadError,
  onRetry,
  pending,
  onApprove,
  onPublish,
  onDismiss,
  onSave,
  onSaveSocialDraft,
  onSaveCmsDraft,
  onUploadCmsAsset,
  onSchedule,
  previewLink,
  onRetryPreview,
  hideHeaderOnMobile,
  onClose,
  actionError,
  onClearActionError,
}: {
  item: QueueItem;
  kbBody?: string;
  kbRevisedBody?: string;
  cmsDetail?: CmsDraftDetailDto;
  loadError?: string;
  onRetry: () => void;
  pending: boolean;
  onApprove: (sendAt?: string | null) => void;
  onPublish?: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onSaveSocialDraft: (edit: SocialDraftEdit) => Promise<void>;
  onSaveCmsDraft: (data: Record<string, unknown>) => Promise<void>;
  onUploadCmsAsset: (file: File) => Promise<CmsAssetExpanded>;
  onSchedule: (scheduledAt: string) => Promise<void>;
  previewLink?: CmsPreviewLink;
  onRetryPreview?: () => void;
  hideHeaderOnMobile?: boolean;
  onClose?: () => void;
  actionError?: QueueActionError;
  onClearActionError?: () => void;
}) {
  switch (item.kind) {
    case 'kb':
      return (
        <KbQueuePane
          actionError={actionError}
          onClearActionError={onClearActionError}
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
        <CrmQueuePane
          item={item}
          pending={pending}
          onApprove={() => onApprove()}
          onDismiss={onDismiss}
          onClose={onClose}
        />
      );
    case 'outreach':
      return (
        <OutreachQueuePane
          item={item}
          pending={pending}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onSave={onSave}
          onClose={onClose}
        />
      );
    case 'social':
      return (
        <SocialQueuePane
          item={item}
          pending={pending}
          onApprove={() => onApprove()}
          onPublish={onPublish}
          onDismiss={onDismiss}
          onSave={onSaveSocialDraft}
          onClose={onClose}
          actionError={actionError}
          onClearActionError={onClearActionError}
        />
      );
    case 'feedback':
      return (
        <FeedbackQueuePane
          actionError={actionError}
          onClearActionError={onClearActionError}
          item={item}
          pending={pending}
          onApprove={() => onApprove()}
          onDismiss={onDismiss}
          onClose={onClose}
        />
      );
    case 'cms':
      return (
        <CmsQueuePane
          actionError={actionError}
          onClearActionError={onClearActionError}
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

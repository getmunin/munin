'use client';

import { QueueDrawer } from './queue-drawers';
import type { QueueItem } from './queue-drawers/types';
import type { InboxController } from './inbox-types';
import { QueueActionErrorBanner } from './queue-action-error';
import { ReviewOutreachPane } from './review-outreach-pane';

export function ReviewBlockingPane({
  item,
  controller,
  afterDecision,
}: {
  item: QueueItem;
  controller: InboxController;
  afterDecision?: (ok: boolean) => void;
}) {
  const {
    pending,
    cmsDetails,
    outreachDetails,
    queueDetailErrors,
    reloadQueueDetail,
    queueActionError,
    clearQueueActionError,
    approveQueue,
    dismissQueue,
    saveQueue,
    saveCmsDraft,
    uploadCmsAsset,
    previewCmsDraft,
    scheduleQueue,
  } = controller;

  if (item.kind === 'outreach') {
    return (
      <ReviewOutreachPane
        item={item}
        evidence={outreachDetails[item.id]?.evidence}
        pending={pending}
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        onApprove={(sendAt) => void approveQueue(item, sendAt).then(afterDecision)}
        onDismiss={() => void dismissQueue(item).then(afterDecision)}
        onSave={(body) => saveQueue(item, body)}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-paper dark:bg-background">
      <QueueActionErrorBanner
        error={queueActionError?.itemId === item.id ? queueActionError : null}
        onDismiss={clearQueueActionError}
      />
      <QueueDrawer
        item={item}
        cmsDetail={item.kind === 'cms' ? cmsDetails[item.id] : undefined}
        loadError={queueDetailErrors[item.id]}
        onRetry={() => reloadQueueDetail(item.id)}
        pending={pending}
        onApprove={(sendAt) => void approveQueue(item, sendAt).then(afterDecision)}
        onDismiss={() => void dismissQueue(item).then(afterDecision)}
        onSave={(body) => saveQueue(item, body)}
        onSaveCmsDraft={(data) => saveCmsDraft(item, data)}
        onUploadCmsAsset={(file) => uploadCmsAsset(item, file)}
        onSchedule={(scheduledAt) => scheduleQueue(item, scheduledAt)}
        onPreview={() => void previewCmsDraft(item)}
      />
    </section>
  );
}

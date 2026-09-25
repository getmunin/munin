'use client';

import { QueueItemPane } from './queue-panes';
import type { QueueItem } from './queue-panes/types';
import type { InboxController } from './inbox-types';
import { ReviewOutreachPane } from './review-outreach-pane';
import { ReviewCrmPane } from './review-crm-pane';
import type { ReviewDecisionOutcome } from './review-queue';

export function ReviewBlockingPane({
  item,
  controller,
  afterDecision,
}: {
  item: QueueItem;
  controller: InboxController;
  afterDecision?: (ok: boolean, outcome: ReviewDecisionOutcome) => void;
}) {
  const {
    pending,
    cmsDetails,
    cmsPreviewLinks,
    reloadCmsPreviewLink,
    outreachDetails,
    queueDetailErrors,
    reloadQueueDetail,
    queueActionError,
    clearQueueActionError,
    approveQueue,
    publishQueue,
    dismissQueue,
    saveQueue,
    saveSocialDraft,
    saveCmsDraft,
    uploadCmsAsset,
    scheduleQueue,
  } = controller;
  const settle = (outcome: ReviewDecisionOutcome) => (ok: boolean) => afterDecision?.(ok, outcome);
  const approvedOrScheduled = (sendAt?: string | null) =>
    settle(sendAt ? 'scheduled' : 'approved');

  if (item.kind === 'crm') {
    return (
      <ReviewCrmPane
        item={item}
        pending={pending}
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        onApprove={() => void approveQueue(item).then(settle('approved'))}
        onDismiss={() => void dismissQueue(item).then(settle('dismissed'))}
      />
    );
  }

  if (item.kind === 'outreach') {
    return (
      <ReviewOutreachPane
        item={item}
        evidence={outreachDetails[item.id]?.evidence}
        pending={pending}
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        onApprove={(sendAt) => void approveQueue(item, sendAt).then(approvedOrScheduled(sendAt))}
        onDismiss={() => void dismissQueue(item).then(settle('dismissed'))}
        onSave={(body) => saveQueue(item, body)}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-paper dark:bg-background">
      <QueueItemPane
        item={item}
        cmsDetail={item.kind === 'cms' ? cmsDetails[item.id] : undefined}
        loadError={queueDetailErrors[item.id]}
        onRetry={() => reloadQueueDetail(item.id)}
        pending={pending}
        onApprove={(sendAt) => void approveQueue(item, sendAt).then(approvedOrScheduled(sendAt))}
        onPublish={
          item.kind === 'social'
            ? () => void publishQueue(item).then(settle('approved'))
            : undefined
        }
        onDismiss={() => void dismissQueue(item).then(settle('dismissed'))}
        onSave={(body) => saveQueue(item, body)}
        onSaveSocialDraft={(edit) => saveSocialDraft(item, edit)}
        onSaveCmsDraft={(data) => saveCmsDraft(item, data)}
        onUploadCmsAsset={(file) => uploadCmsAsset(item, file)}
        onSchedule={(scheduledAt) =>
          scheduleQueue(item, scheduledAt).then(() => settle('scheduled')(true))
        }
        previewLink={item.kind === 'cms' ? cmsPreviewLinks[item.id] : undefined}
        onRetryPreview={
          item.kind === 'cms' ? () => void reloadCmsPreviewLink(item.id) : undefined
        }
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        hideHeaderOnMobile
      />
    </section>
  );
}

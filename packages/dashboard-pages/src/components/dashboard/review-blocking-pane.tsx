'use client';

import { QueueItemPane } from './queue-panes';
import type { QueueItem } from './queue-panes/types';
import type { InboxController } from './inbox-types';
import { ReviewOutreachPane } from './review-outreach-pane';
import { ReviewCrmPane } from './review-crm-pane';
import { ReviewBroadcastPane } from './review-broadcast-pane';
import type { ReviewDecisionOutcome } from './review-queue';

export function ReviewBlockingPane({
  item,
  controller,
  decide = (_outcome, run) => run(),
}: {
  item: QueueItem;
  controller: InboxController;
  decide?: (outcome: ReviewDecisionOutcome, run: () => Promise<boolean>) => Promise<boolean>;
}) {
  const {
    pending,
    cmsDetails,
    cmsPreviewLinks,
    reloadCmsPreviewLink,
    outreachDetails,
    broadcastDetails,
    reloadBroadcastDetail,
    sendBroadcastTest,
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
  const approve = (sendAt?: string | null) =>
    void decide(sendAt ? 'scheduled' : 'approved', () => approveQueue(item, sendAt));
  const dismiss = () => void decide('dismissed', () => dismissQueue(item));

  if (item.kind === 'crm') {
    return (
      <ReviewCrmPane
        item={item}
        pending={pending}
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        onApprove={() => approve()}
        onDismiss={dismiss}
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
        onApprove={approve}
        onDismiss={dismiss}
        onSave={(body) => saveQueue(item, body)}
      />
    );
  }

  if (item.kind === 'broadcast') {
    return (
      <ReviewBroadcastPane
        item={item}
        detail={broadcastDetails[item.id]}
        loadError={queueDetailErrors[item.id]}
        pending={pending}
        actionError={queueActionError}
        onClearActionError={clearQueueActionError}
        onRetry={() => reloadQueueDetail(item.id)}
        onReload={() => {
          clearQueueActionError();
          void reloadBroadcastDetail(item.id);
        }}
        onApprove={approve}
        onDismiss={dismiss}
        onSendTest={() => sendBroadcastTest(item.id)}
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
        onApprove={approve}
        onPublish={
          item.kind === 'social'
            ? () => void decide('approved', () => publishQueue(item))
            : undefined
        }
        onDismiss={dismiss}
        onSave={(body) => saveQueue(item, body)}
        onSaveSocialDraft={(edit) => saveSocialDraft(item, edit)}
        onSaveCmsDraft={(data) => saveCmsDraft(item, data)}
        onUploadCmsAsset={(file) => uploadCmsAsset(item, file)}
        onSchedule={async (scheduledAt) => {
          await decide('scheduled', () => scheduleQueue(item, scheduledAt).then(() => true));
        }}
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

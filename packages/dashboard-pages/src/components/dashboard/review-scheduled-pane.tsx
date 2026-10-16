'use client';

import { ScheduledItemPane } from './queue-panes';
import type { ScheduledItem } from './queue-panes/types';
import type { InboxController } from './inbox-types';
import { ScheduledBroadcastPane } from './review-scheduled-broadcast-pane';

export function ReviewScheduledPane({
  item,
  controller,
}: {
  item: ScheduledItem;
  controller: InboxController;
}) {
  const { pending, cmsDetails, queueDetailErrors, reloadQueueDetail, setCancelTarget } = controller;

  if (item.kind === 'broadcast') {
    return (
      <section className="flex min-h-0 flex-col overflow-hidden bg-paper dark:bg-background">
        <ScheduledBroadcastPane
          broadcast={item.raw}
          at={item.at}
          pending={pending}
          onCancel={() => setCancelTarget(item)}
          hideHeaderOnMobile
        />
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-paper dark:bg-background">
      <ScheduledItemPane
        item={item}
        cmsDetail={item.kind === 'cms' ? cmsDetails[item.id] : undefined}
        loadError={queueDetailErrors[item.id]}
        onRetry={() => reloadQueueDetail(item.id)}
        pending={pending}
        onCancel={() => setCancelTarget(item)}
        hideHeaderOnMobile
      />
    </section>
  );
}

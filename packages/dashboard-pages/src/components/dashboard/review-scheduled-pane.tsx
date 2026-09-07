'use client';

import { ScheduledDrawer } from './queue-drawers';
import type { ScheduledItem } from './queue-drawers/types';
import type { InboxController } from './inbox-types';

export function ReviewScheduledPane({
  item,
  controller,
}: {
  item: ScheduledItem;
  controller: InboxController;
}) {
  const { pending, cmsDetails, queueDetailErrors, reloadQueueDetail, setCancelTarget } = controller;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-paper dark:bg-background">
      <ScheduledDrawer
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

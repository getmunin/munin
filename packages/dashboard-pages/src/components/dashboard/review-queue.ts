import type { QueueItem } from './queue-drawers/types';

export type KbQueueItem = QueueItem & { kind: 'kb' };

export interface ReviewPartition {
  blocking: QueueItem[];
  improvements: KbQueueItem[];
}

function millis(iso: string): number {
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function partitionReviewQueue(queue: QueueItem[]): ReviewPartition {
  const blocking: QueueItem[] = [];
  const improvements: KbQueueItem[] = [];
  for (const item of queue) {
    if (item.kind === 'kb') improvements.push(item);
    else blocking.push(item);
  }
  blocking.sort((a, b) => millis(a.createdAt) - millis(b.createdAt));
  improvements.sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  return { blocking, improvements };
}

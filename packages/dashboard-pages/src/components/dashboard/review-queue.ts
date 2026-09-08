import type { SetupReviewQueue } from '../first-run/setup-snapshot';
import { withinDecidedWindow } from './curation-decisions';
import type { QueueItem } from './queue-panes/types';

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

export function resolveReviewFirstRun(
  setupQueue: SetupReviewQueue | null,
  list: { loaded: boolean; empty: boolean },
  now = Date.now(),
): boolean | null {
  if (list.loaded) return list.empty;
  if (!setupQueue || setupQueue.hasPendingItems) return null;
  const { lastDecisionAt } = setupQueue;
  if (lastDecisionAt !== null && withinDecidedWindow(lastDecisionAt, now)) return null;
  return true;
}

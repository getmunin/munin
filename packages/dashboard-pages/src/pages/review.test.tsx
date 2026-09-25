import { act, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import type { CmsDraftSummaryDto, QueueItem } from '../components/dashboard/queue-panes/types';
import type { InboxController } from '../components/dashboard/inbox-types';
import type {
  ReviewDecidedController,
  ReviewDecidedItem,
} from '../components/dashboard/review-decided';
import type { ReviewDecisionOutcome } from '../components/dashboard/review-queue';
import type * as ReviewDecidedModule from '../components/dashboard/review-decided';

const harness = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    path: '/dashboard/review',
    realtimeMs: 1,
    settleMs: 5,
    approveOk: true,
    queue: [] as QueueItem[],
    decided: [] as ReviewDecidedItem[],
  };
  return {
    state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
});

function useHarness<T>(read: () => T): T {
  return useSyncExternalStore(harness.subscribe, read);
}

vi.mock('../i18n-navigation', () => ({
  usePathname: () => useHarness(() => harness.state.path),
  useOrgHref: () => (path: string) => path,
  useRouter: () => ({
    push: (path: string) => {
      setTimeout(() => {
        harness.state.path = path;
        harness.emit();
      }, 0);
    },
  }),
}));

vi.mock('../components/dashboard/inbox-data', () => ({
  useInboxData: (): InboxController => {
    const queue = useHarness(() => harness.state.queue);
    return {
      queue,
      scheduled: [],
      hasLoadedOnce: true,
      loadError: null,
      retrying: false,
      retryLoad: () => Promise.resolve(),
      setActiveQueueItem: () => undefined,
      setActiveScheduledItem: () => undefined,
    } as Partial<InboxController> as InboxController;
  },
}));

vi.mock('../components/dashboard/review-decided', async (importOriginal) => ({
  ...(await importOriginal<typeof ReviewDecidedModule>()),
  useReviewDecided: (): ReviewDecidedController => {
    const items = useHarness(() => harness.state.decided);
    return {
      items,
      hasLoadedOnce: true,
      reload: () => Promise.resolve(),
    } as Partial<ReviewDecidedController> as ReviewDecidedController;
  },
}));

vi.mock('../components/first-run', () => ({
  useFirstRunGate: () => ({ view: 'ready', setup: {} }),
  ReviewFirstRun: () => null,
}));

vi.mock('../shells/mobile-back', () => ({ useProvideMobileBack: () => undefined }));
vi.mock('../lib/use-load-failed-props', () => ({ useInboxLoadFailedProps: () => () => ({}) }));
vi.mock('../components/dashboard/scheduled-cancel-dialog', () => ({
  ScheduledCancelDialog: () => null,
}));

vi.mock('../components/dashboard/review-row', () => ({
  ReviewRow: ({ item, onSelect }: { item: QueueItem; onSelect: () => void }) => (
    <li>
      <button type="button" onClick={onSelect}>
        row {item.id}
      </button>
    </li>
  ),
}));

vi.mock('../components/dashboard/review-decided-row', () => ({
  ReviewDecidedRow: ({ item }: { item: ReviewDecidedItem }) => <li>decided row {item.id}</li>,
}));

vi.mock('../components/dashboard/review-decided-pane', () => ({
  ReviewDecidedPane: ({ item }: { item: ReviewDecidedItem }) => (
    <section>decided pane {item.id}</section>
  ),
}));

vi.mock('../components/dashboard/review-blocking-pane', () => ({
  ReviewBlockingPane: ({
    item,
    decide,
  }: {
    item: QueueItem;
    decide?: (outcome: ReviewDecisionOutcome, run: () => Promise<boolean>) => Promise<boolean>;
  }) => (
    <section>
      <span>waiting pane {item.id}</span>
      <button type="button" onClick={() => void decide?.('approved', () => approveOnServer(item))}>
        publish {item.id}
      </button>
    </section>
  ),
}));

import { ReviewPage } from './review';

function cmsItem(id: string, createdAt: string): QueueItem {
  return {
    kind: 'cms',
    id,
    title: `Entry ${id}`,
    snippet: '',
    createdAt,
    raw: {},
  } as QueueItem;
}

function decidedFor(item: QueueItem): ReviewDecidedItem {
  return {
    kind: 'cms',
    state: 'decided',
    id: item.id,
    at: '2026-09-25T12:00:00.000Z',
    raw: { title: item.title } as CmsDraftSummaryDto,
    outcome: 'approved',
    reason: null,
    decidedBy: { actorType: 'user', actorId: 'user_viewer', name: null },
    producedRef: null,
  };
}

function decideElsewhere(item: QueueItem) {
  harness.state.queue = harness.state.queue.filter((q) => q.id !== item.id);
  harness.state.decided = [decidedFor(item), ...harness.state.decided];
  harness.emit();
}

function approveOnServer(item: QueueItem): Promise<boolean> {
  return new Promise((resolve) => {
    if (harness.state.approveOk) setTimeout(() => decideElsewhere(item), harness.state.realtimeMs);
    setTimeout(() => resolve(harness.state.approveOk), harness.state.settleMs);
  });
}

function selectedTab(): string | null {
  return screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')
    ?.textContent ?? null;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('ReviewPage decisions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as Partial<MediaQueryList> as typeof window.matchMedia;
    harness.state.path = '/dashboard/review/b';
    harness.state.realtimeMs = 1;
    harness.state.settleMs = 5;
    harness.state.approveOk = true;
    harness.state.queue = [
      cmsItem('a', '2026-09-25T09:00:00.000Z'),
      cmsItem('b', '2026-09-25T10:00:00.000Z'),
      cmsItem('c', '2026-09-25T11:00:00.000Z'),
    ];
    harness.state.decided = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never shows the decided item when realtime moves it to Decided before the approval returns', async () => {
    renderWithProviders(<ReviewPage />);
    expect(screen.getByText('waiting pane b')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'publish b' }));
    await advance(1);

    expect(harness.state.path).toBe('/dashboard/review/b');
    expect(selectedTab()).toContain('Waiting');
    expect(screen.getByText('waiting pane c')).toBeTruthy();
    expect(screen.queryByText('decided pane b')).toBeNull();

    await advance(10);

    expect(harness.state.path).toBe('/dashboard/review/c');
    expect(selectedTab()).toContain('Waiting');
    expect(screen.getByText('waiting pane c')).toBeTruthy();
  });

  it('opens the next item when the approval returns before the lists reload', async () => {
    harness.state.realtimeMs = 20;
    harness.state.settleMs = 1;
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'publish b' }));
    await advance(2);

    expect(screen.getByText('waiting pane c')).toBeTruthy();

    await advance(30);

    expect(harness.state.path).toBe('/dashboard/review/c');
    expect(selectedTab()).toContain('Waiting');
    expect(screen.queryByText('decided pane b')).toBeNull();
  });

  it('keeps the item open when the approval fails', async () => {
    harness.state.approveOk = false;
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'publish b' }));
    await advance(10);

    expect(harness.state.path).toBe('/dashboard/review/b');
    expect(screen.getByText('waiting pane b')).toBeTruthy();
    expect(screen.queryAllByText('Published')).toHaveLength(0);
  });

  it('confirms the decision above the next item until it times out', async () => {
    renderWithProviders(<ReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'publish b' }));
    await advance(10);

    expect(screen.getAllByText('Entry b').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryAllByText('Entry b')).toHaveLength(0);
  });

  it('opens the item above when the decided one was last in the list', async () => {
    harness.state.path = '/dashboard/review/c';
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'publish c' }));
    await advance(10);

    expect(harness.state.path).toBe('/dashboard/review/b');
    expect(screen.getByText('waiting pane b')).toBeTruthy();
  });

  it('shows the resolved item when someone else decides the one being viewed', () => {
    renderWithProviders(<ReviewPage />);

    act(() => {
      decideElsewhere(harness.state.queue[1]!);
    });

    expect(selectedTab()).toContain('Decided');
    expect(screen.getByText('decided pane b')).toBeTruthy();
    expect(screen.queryAllByText('Published')).toHaveLength(0);
  });
});

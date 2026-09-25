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
    afterDecision,
  }: {
    item: QueueItem;
    afterDecision?: (ok: boolean, outcome: ReviewDecisionOutcome) => void;
  }) => (
    <section>
      <span>waiting pane {item.id}</span>
      <button type="button" onClick={() => decide(item, () => afterDecision?.(true, 'approved'))}>
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

function decide(item: QueueItem, settle: () => void) {
  harness.state.queue = harness.state.queue.filter((q) => q.id !== item.id);
  harness.state.decided = [decidedFor(item), ...harness.state.decided];
  harness.emit();
  settle();
}

function selectedTab(): string | null {
  return screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')
    ?.textContent ?? null;
}

function flushNavigation() {
  act(() => {
    vi.advanceTimersByTime(1);
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

  it('stays on Waiting and opens the next item even when the decided list lands before the URL', () => {
    renderWithProviders(<ReviewPage />);
    expect(screen.getByText('waiting pane b')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'publish b' }));

    expect(selectedTab()).toContain('Waiting');
    expect(screen.getByText('waiting pane c')).toBeTruthy();
    expect(screen.queryByText('decided pane b')).toBeNull();

    flushNavigation();

    expect(harness.state.path).toBe('/dashboard/review/c');
    expect(selectedTab()).toContain('Waiting');
    expect(screen.getByText('waiting pane c')).toBeTruthy();
  });

  it('confirms the decision above the next item until it times out', () => {
    renderWithProviders(<ReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'publish b' }));
    flushNavigation();

    expect(screen.getAllByText('Entry b').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryAllByText('Entry b')).toHaveLength(0);
  });

  it('opens the item above when the decided one was last in the list', () => {
    harness.state.path = '/dashboard/review/c';
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'publish c' }));
    flushNavigation();

    expect(harness.state.path).toBe('/dashboard/review/b');
    expect(screen.getByText('waiting pane b')).toBeTruthy();
  });

  it('shows the resolved item when someone else decides the one being viewed', () => {
    renderWithProviders(<ReviewPage />);

    act(() => {
      decide(harness.state.queue[1]!, () => undefined);
    });

    expect(selectedTab()).toContain('Decided');
    expect(screen.getByText('decided pane b')).toBeTruthy();
    expect(screen.queryAllByText('Published')).toHaveLength(0);
  });
});

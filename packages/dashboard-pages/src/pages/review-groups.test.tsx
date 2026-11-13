import { act, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import type {
  CmsEntryStatus,
  CmsTranslationDto,
  QueueItem,
} from '../components/dashboard/queue-panes/types';
import type { CmsPaneGroup } from '../components/dashboard/queue-panes/cms';
import type { CmsGroupAction, InboxController } from '../components/dashboard/inbox-types';
import type {
  ReviewDecidedController,
  ReviewDecidedItem,
} from '../components/dashboard/review-decided';
import type { ReviewGroup } from '../components/dashboard/review-queue';
import type * as ReviewDecidedModule from '../components/dashboard/review-decided';

const harness = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    path: '/dashboard/review',
    queue: [] as QueueItem[],
    focus: [] as Array<[string | null, string | null]>,
    approvedGroups: [] as CmsGroupAction[],
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

function removeFromQueue(ids: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      harness.state.queue = harness.state.queue.filter((item) => !ids.includes(item.id));
      harness.emit();
    }, 1);
    setTimeout(() => resolve(true), 5);
  });
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
      isPending: () => false,
      setActiveQueueItem: () => undefined,
      setActiveScheduledItem: () => undefined,
      cmsDetails: {},
      cmsPreviewLinks: {},
      queueDetailErrors: {},
      queueActionError: null,
      focusCmsEntries: (openId: string | null, referenceId: string | null) => {
        harness.state.focus.push([openId, referenceId]);
      },
      approveQueue: (item: QueueItem) => removeFromQueue([item.id]),
      approveCmsGroup: (group: CmsGroupAction) => {
        harness.state.approvedGroups.push(group);
        return removeFromQueue(group.members.map((member) => member.id));
      },
    } as Partial<InboxController> as InboxController;
  },
}));

vi.mock('../components/dashboard/review-decided', async (importOriginal) => ({
  ...(await importOriginal<typeof ReviewDecidedModule>()),
  useReviewDecided: (): ReviewDecidedController =>
    ({
      items: [] as ReviewDecidedItem[],
      hasLoadedOnce: true,
      reload: () => Promise.resolve(),
    }) as Partial<ReviewDecidedController> as ReviewDecidedController,
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
  ReviewGroupRow: ({ group, onSelect }: { group: ReviewGroup; onSelect: () => void }) => (
    <li>
      <button type="button" onClick={onSelect}>
        group row {group.groupId} led by {group.lead.locale}
      </button>
    </li>
  ),
}));

vi.mock('../components/dashboard/review-blocking-pane', () => ({
  ReviewBlockingPane: ({ item }: { item: QueueItem }) => <section>plain pane {item.id}</section>,
}));

vi.mock('../components/dashboard/queue-panes/cms', () => ({
  CmsQueuePane: ({
    item,
    group,
    onApprove,
  }: {
    item: { id: string };
    group?: CmsPaneGroup;
    onApprove: () => void;
  }) => (
    <div>
      <span>open {item.id}</span>
      <span>waiting {group?.waitingLocales.join(',')}</span>
      <span>compares with {group?.reference?.locale ?? 'nothing'}</span>
      {group?.translations.map((tr) => (
        <button key={tr.id} type="button" onClick={() => group.onOpen(tr.id)}>
          language {tr.locale}
        </button>
      ))}
      <button type="button" onClick={() => group?.onApproveAll()}>
        approve all
      </button>
      <button type="button" onClick={onApprove}>
        approve only
      </button>
    </div>
  ),
}));

import { ReviewPage } from './review';

function plain(id: string, createdAt: string): QueueItem {
  return { kind: 'cms', id, title: `Entry ${id}`, snippet: '', createdAt, raw: {} } as QueueItem;
}

function translations(groupId: string, statuses: Record<string, CmsEntryStatus>): QueueItem[] {
  const siblings: CmsTranslationDto[] = Object.entries(statuses).map(([locale, status]) => ({
    id: `${groupId}_${locale}`,
    locale,
    status,
    version: 3,
    title: `Roles ${locale}`,
    isDefaultLocale: false,
  }));
  return siblings
    .filter((sibling) => sibling.status === 'draft')
    .map((sibling) => ({
      kind: 'cms',
      id: sibling.id,
      title: sibling.title,
      snippet: '',
      createdAt: '2026-09-25T10:00:00.000Z',
      raw: {
        id: sibling.id,
        collectionId: 'cmc_1',
        collectionSlug: 'changelog',
        collectionName: 'Changelog',
        slug: sibling.locale,
        locale: sibling.locale,
        translationGroupId: groupId,
        translations: siblings,
        title: sibling.title,
        titleFieldName: 'title',
        wordCount: 12,
        version: sibling.version,
        updatedAt: '2026-09-25T10:00:00.000Z',
      },
    }));
}

function arrivalClass(text: string): string {
  return screen.getByText(text).closest('section')?.parentElement?.className ?? '';
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('ReviewPage translation groups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as Partial<MediaQueryList> as typeof window.matchMedia;
    harness.state.path = '/dashboard/review/g_en';
    harness.state.focus = [];
    harness.state.approvedGroups = [];
    harness.state.queue = [
      plain('a', '2026-09-25T09:00:00.000Z'),
      ...translations('g', { nb: 'draft', en: 'draft', sv: 'draft' }),
      plain('z', '2026-09-25T11:00:00.000Z'),
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists one row per translation group, led by the reviewer language, and counts it once', () => {
    renderWithProviders(<ReviewPage />);

    expect(screen.getByRole('button', { name: 'group row g led by en' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'row g_en' })).toBeNull();
    expect(screen.getAllByRole('tab')[0]?.textContent).toContain('3');
    expect(screen.getByText('waiting en,nb,sv')).toBeTruthy();
  });

  it('opens the linked locale when a deep link points at a translation, and compares it with the reviewer language', () => {
    harness.state.path = '/dashboard/review/g_sv';
    renderWithProviders(<ReviewPage />);

    expect(screen.getByText('open g_sv')).toBeTruthy();
    expect(screen.getByText('compares with en')).toBeTruthy();
    expect(harness.state.focus.at(-1)).toEqual(['g_sv', 'g_en']);
  });

  it('approving all sends every waiting version and hands off past the group', async () => {
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'approve all' }));
    await advance(20);

    expect(harness.state.approvedGroups).toEqual([
      {
        groupId: 'g',
        anchorId: 'g_en',
        members: [
          { id: 'g_en', version: 3 },
          { id: 'g_nb', version: 3 },
          { id: 'g_sv', version: 3 },
        ],
      },
    ]);
    expect(harness.state.path).toBe('/dashboard/review/z');
    expect(screen.getByText('plain pane z')).toBeTruthy();
    expect(screen.getAllByText('Approved · 3 languages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Roles en').length).toBeGreaterThan(0);
  });

  it('approving one locale moves to the next waiting locale of the same group without an arrival', async () => {
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'approve only' }));
    await advance(20);

    expect(harness.state.path).toBe('/dashboard/review/g_nb');
    expect(screen.getByText('open g_nb')).toBeTruthy();
    expect(screen.getByText('waiting nb,sv')).toBeTruthy();
    expect(arrivalClass('open g_nb')).not.toMatch(/animate-arrive/);
  });

  it('wraps to the first waiting locale after the last one is approved on its own', async () => {
    harness.state.path = '/dashboard/review/g_sv';
    renderWithProviders(<ReviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'approve only' }));
    await advance(20);

    expect(harness.state.path).toBe('/dashboard/review/g_en');
    expect(screen.getByText('open g_en')).toBeTruthy();
  });

  it('shows a published sibling in place without leaving the waiting locale in the address', async () => {
    harness.state.queue = [
      ...translations('h', { en: 'published', nb: 'draft', sv: 'draft' }),
      plain('z', '2026-09-25T11:00:00.000Z'),
    ];
    harness.state.path = '/dashboard/review/h_nb';
    renderWithProviders(<ReviewPage />);
    expect(screen.getByText('compares with en')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'language en' }));
    await advance(5);

    expect(screen.getByText('open h_en')).toBeTruthy();
    expect(screen.getByText('compares with nothing')).toBeTruthy();
    expect(harness.state.path).toBe('/dashboard/review/h_nb');
    expect(harness.state.focus.at(-1)).toEqual(['h_en', null]);

    fireEvent.click(screen.getByRole('button', { name: 'language sv' }));
    await advance(5);

    expect(harness.state.path).toBe('/dashboard/review/h_sv');
    expect(screen.getByText('open h_sv')).toBeTruthy();
  });
});

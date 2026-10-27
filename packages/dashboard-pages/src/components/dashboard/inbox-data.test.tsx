import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import type { InboxQueueResponse, ReviewWireItem } from './inbox-types';
import type * as ApiModule from '../../api';

type KbWire = Extract<ReviewWireItem, { kind: 'kb' }>;

const net = vi.hoisted(() => ({
  inbox: [] as { resolve: (res: InboxQueueResponse) => void }[],
  realtime: null as null | ((event: { type: string }) => void),
}));

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: (path: string) => {
    if (path === '/v1/inbox') {
      return new Promise<InboxQueueResponse>((resolve) => net.inbox.push({ resolve }));
    }
    return Promise.resolve({});
  },
}));

vi.mock('../../realtime', () => ({
  useRealtime: (_subs: unknown, onEvent: (event: { type: string }) => void) => {
    net.realtime = onEvent;
    return { status: 'connected' };
  },
}));

import { useInboxData } from './inbox-data';

function kb(id: string): KbWire {
  return {
    kind: 'kb',
    state: 'waiting',
    id,
    at: '2026-10-27T09:00:00.000Z',
    raw: { title: `Candidate ${id}`, revisesDocumentId: null, proposedTargetSpaceSlug: null },
  } as KbWire;
}

function inbox(...ids: string[]): InboxQueueResponse {
  return { live: [], liveTotal: 0, waiting: ids.map(kb), scheduled: [] };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

async function respond(call: number, res: InboxQueueResponse) {
  await waitFor(() => expect(net.inbox.length).toBeGreaterThan(call));
  await act(() => {
    net.inbox[call]!.resolve(res);
    return Promise.resolve();
  });
}

async function mount() {
  const hook = renderHook(() => useInboxData(), { wrapper });
  await respond(0, inbox('a', 'b'));
  expect(hook.result.current.queue.map((q) => q.id)).toEqual(['a', 'b']);
  return hook;
}

describe('useInboxData', () => {
  beforeEach(() => {
    net.inbox = [];
    net.realtime = null;
  });

  it('leaves the next item actionable while the decided one waits on its own refresh', async () => {
    const { result } = await mount();

    let dismissed!: Promise<boolean>;
    act(() => {
      dismissed = result.current.dismissQueue(result.current.queue[0]!);
    });
    expect(result.current.isPending('a')).toBe(true);

    await waitFor(() => expect(net.inbox).toHaveLength(2));
    act(() => net.realtime!({ type: 'kb.curation_candidate.dismissed' }));
    await respond(2, inbox('b'));

    expect(result.current.queue.map((q) => q.id)).toEqual(['b']);
    expect(result.current.isPending('a')).toBe(true);
    expect(result.current.isPending('b')).toBe(false);

    await respond(1, inbox('b'));
    await act(async () => {
      expect(await dismissed).toBe(true);
    });
    expect(result.current.isPending('a')).toBe(false);
  });

  it('keeps the newest inbox when an older response arrives last', async () => {
    const { result } = await mount();

    act(() => net.realtime!({ type: 'kb.curation_candidate.dismissed' }));
    act(() => net.realtime!({ type: 'kb.curation_candidate.dismissed' }));
    await respond(2, inbox('b'));
    await respond(1, inbox('a', 'b'));

    expect(result.current.queue.map((q) => q.id)).toEqual(['b']);
  });
});

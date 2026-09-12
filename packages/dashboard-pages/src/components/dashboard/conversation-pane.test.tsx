import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import {
  VIEWER_USER_ID,
  makeDetail,
  makeDraft,
  makeItem,
  makeMessage,
  stubController,
} from '../../test/inbox-fixtures';
import { ConversationPane } from './conversation-pane';
import type { QueueController } from './conversation-queue';
import type { ConversationDetail } from './inbox-types';

const DRAFT_A = 'Your order shipped on Tuesday.';
const DRAFT_B = 'We refunded the duplicate charge.';

function detailWithDraft(id: string, body: string): ConversationDetail {
  return makeDetail(id, {
    messages: [
      makeMessage({ id: `${id}_m1`, conversationId: id }),
      makeDraft(id, `${id}_draft`, body),
    ],
  });
}

function pane(id: string, detail: ConversationDetail, controller: QueueController) {
  return (
    <ConversationPane
      selectedId={id}
      item={makeItem(id)}
      detail={detail}
      controller={controller}
      viewerUserId={VIEWER_USER_ID}
    />
  );
}

function replyBox(): HTMLTextAreaElement {
  return screen.getByPlaceholderText<HTMLTextAreaElement>('Write the reply to Ada Customer…');
}

function restoreDraftButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Restore draft' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationPane composer', () => {
  it('seeds the composer from the draft and offers approve-and-send', () => {
    renderWithProviders(pane('conv_a', detailWithDraft('conv_a', DRAFT_A), stubController()));

    expect(replyBox().value).toBe(DRAFT_A);
    expect(screen.getByRole('button', { name: 'Approve & send' })).toBeTruthy();
    expect(restoreDraftButton()).toBeNull();
  });

  it('reopening a conversation with a cached draft seeds the composer and is not dirty', () => {
    const controller = stubController();
    const { rerender } = renderWithProviders(
      pane('conv_a', detailWithDraft('conv_a', DRAFT_A), controller),
    );
    expect(replyBox().value).toBe(DRAFT_A);

    rerender(pane('conv_b', detailWithDraft('conv_b', DRAFT_B), controller));

    expect(replyBox().value).toBe(DRAFT_B);
    expect(screen.queryByText('edited by you')).toBeNull();
    expect(restoreDraftButton()).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve & send' })).toBeTruthy();
  });

  it('typing then switching conversations does not carry dirty across', () => {
    const controller = stubController();
    const { rerender } = renderWithProviders(pane('conv_a', makeDetail('conv_a'), controller));

    fireEvent.change(replyBox(), { target: { value: 'half-written operator reply' } });
    expect(replyBox().value).toBe('half-written operator reply');

    rerender(pane('conv_b', detailWithDraft('conv_b', DRAFT_B), controller));

    expect(replyBox().value).toBe(DRAFT_B);
    expect(screen.queryByText('edited by you')).toBeNull();
    expect(restoreDraftButton()).toBeNull();
  });

  it('a streamed draft is not dirty mid-stream', () => {
    vi.useFakeTimers();
    const drafting = stubController({ draftRequested: { conv_a: true } });
    const { rerender } = renderWithProviders(pane('conv_a', makeDetail('conv_a'), drafting));
    expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);

    rerender(pane('conv_a', detailWithDraft('conv_a', DRAFT_A), stubController()));

    act(() => {
      vi.advanceTimersByTime(24 * 2);
    });
    expect(replyBox().value.length).toBeGreaterThan(0);
    expect(replyBox().value.length).toBeLessThan(DRAFT_A.length);
    expect(screen.getAllByText('Writing').length).toBeGreaterThan(0);
    expect(screen.queryByText('edited by you')).toBeNull();
    expect(restoreDraftButton()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(24 * DRAFT_A.length);
    });
    expect(replyBox().value).toBe(DRAFT_A);
    expect(screen.queryByText('edited by you')).toBeNull();
    expect(restoreDraftButton()).toBeNull();
  });

  it('clearing the box by hand is dirty and Restore draft refills it', () => {
    renderWithProviders(pane('conv_a', detailWithDraft('conv_a', DRAFT_A), stubController()));

    fireEvent.change(replyBox(), { target: { value: '' } });

    expect(screen.getAllByText('edited by you').length).toBeGreaterThan(0);
    expect(restoreDraftButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }));

    expect(replyBox().value).toBe(DRAFT_A);
    expect(screen.queryByText('edited by you')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve & send' })).toBeTruthy();
  });
});

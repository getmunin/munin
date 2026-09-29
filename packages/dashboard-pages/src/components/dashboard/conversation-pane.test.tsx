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
  return screen.getByPlaceholderText<HTMLTextAreaElement>(
    'Write the reply to Ada Customer — or a rough note, and ask for a draft…',
  );
}

function restoreDraftButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Restore draft' });
}

function failureBlocks(): HTMLElement[] {
  return screen.queryAllByRole('alert');
}

function retrySendButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: 'Retry send' });
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

  it('a send failure stays on its own conversation when you switch away and back', () => {
    const controller = stubController({
      actionError: {
        type: 'send',
        conversationId: 'conv_a',
        message: 'conv_send_failed: the relay refused it',
        code: 'conv_send_failed',
        attempt: 2,
      },
    });
    const { rerender } = renderWithProviders(
      pane('conv_a', makeDetail('conv_a'), controller),
    );

    expect(failureBlocks().length).toBeGreaterThan(0);
    for (const block of failureBlocks()) {
      expect(block.textContent).toContain('conv_send_failed: the relay refused it (2)');
    }
    expect(retrySendButtons().length).toBeGreaterThan(0);

    rerender(pane('conv_b', detailWithDraft('conv_b', DRAFT_B), controller));

    expect(failureBlocks()).toHaveLength(0);
    expect(retrySendButtons()).toHaveLength(0);

    rerender(pane('conv_a', makeDetail('conv_a'), controller));

    expect(failureBlocks().length).toBeGreaterThan(0);
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

  it('asking for a draft with text in the box sends that text as the note', () => {
    const requestDraft = vi.fn(() => Promise.resolve());
    renderWithProviders(
      pane('conv_a', makeDetail('conv_a'), stubController({ requestDraft })),
    );

    expect(screen.getAllByRole('button', { name: 'Ask for a draft' }).length).toBeGreaterThan(0);
    fireEvent.change(replyBox(), { target: { value: 'Refund is approved, 3–5 days.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Draft from my note' })[0]!);

    expect(requestDraft).toHaveBeenCalledWith('conv_a', 'Refund is approved, 3–5 days.', undefined);
  });

  it('a note lets you ask for a draft even when the customer did not write last', () => {
    const detail = makeDetail('conv_a', {
      messages: [
        makeMessage({ id: 'conv_a_m1', conversationId: 'conv_a' }),
        makeMessage({
          id: 'conv_a_m2',
          conversationId: 'conv_a',
          authorType: 'agent',
          authorId: 'agent_1',
          authorName: 'Munin',
          body: 'It shipped on Tuesday.',
        }),
      ],
    });
    renderWithProviders(pane('conv_a', detail, stubController()));

    expect(screen.queryByRole('button', { name: 'Ask for a draft' })).toBeNull();
    fireEvent.change(replyBox(), { target: { value: 'Follow up on the tracking link.' } });
    expect(screen.getAllByRole('button', { name: 'Draft from my note' }).length).toBeGreaterThan(0);
  });

  it('holds Approve & send until every [ ] slot in the draft is filled in', () => {
    const draft = makeDraft('conv_a', 'conv_a_draft', 'Your refund of [AMOUNT] is on its way.');
    draft.metadata = { kind: 'draft_reply', slots: ['[AMOUNT]'] };
    const detail = makeDetail('conv_a', {
      messages: [makeMessage({ id: 'conv_a_m1', conversationId: 'conv_a' }), draft],
    });
    renderWithProviders(pane('conv_a', detail, stubController()));

    const approve = screen.getByRole<HTMLButtonElement>('button', { name: 'Approve & send' });
    expect(approve.disabled).toBe(true);

    fireEvent.change(replyBox(), { target: { value: 'Your refund of 40 EUR is on its way.' } });

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send reply' }).disabled).toBe(
      false,
    );
  });

  it('translates a reply to a foreign-language customer, and sends it as typed once unticked', () => {
    const send = vi.fn(() => Promise.resolve(true));
    const detail = makeDetail('conv_a', { customerLanguage: 'es' });
    renderWithProviders(pane('conv_a', detail, stubController({ send })));

    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Translate to Spanish' });
    expect(box.checked).toBe(true);
    fireEvent.change(replyBox(), { target: { value: 'We refund you today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(send).toHaveBeenLastCalledWith('conv_a', 'We refund you today.', undefined, [], 'en');

    fireEvent.click(box);
    fireEvent.change(replyBox(), { target: { value: 'We refund you today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send in English' }));
    expect(send).toHaveBeenLastCalledWith('conv_a', 'We refund you today.', undefined, [], undefined);
  });

  it('asks for the draft in the teammate language while translation is on', () => {
    const requestDraft = vi.fn(() => Promise.resolve());
    const detail = makeDetail('conv_a', { customerLanguage: 'es' });
    renderWithProviders(pane('conv_a', detail, stubController({ requestDraft })));

    fireEvent.change(replyBox(), { target: { value: 'Refund approved.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Draft from my note' })[0]!);
    expect(requestDraft).toHaveBeenCalledWith('conv_a', 'Refund approved.', 'en');
  });

  it('offers no translation choice when the customer writes the teammate language', () => {
    renderWithProviders(
      pane('conv_a', makeDetail('conv_a', { customerLanguage: 'en' }), stubController()),
    );
    expect(screen.queryByRole('checkbox', { name: /Translate to/ })).toBeNull();
  });
});


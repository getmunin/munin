import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render';
import { SocialQueuePane } from './social';
import type { SocialDraftDto, SocialDraftEdit } from './types';

vi.mock('../../../auth/use-active-role', () => ({
  useActiveMembership: () => ({ membership: { name: 'Ola Nordmann' } }),
}));

const BODY = 'We rebuilt our support desk around one idea.';

function draft(over: Partial<SocialDraftDto> = {}): SocialDraftDto {
  return {
    id: 'sod_1',
    platform: 'linkedin',
    setId: 'sos_1',
    variantLabel: 'single',
    body: BODY,
    linkUrl: 'https://example.test/blog/agent-first-support',
    shareUrl: 'https://example.test/blog/agent-first-support?utm_source=linkedin',
    linkPlacement: 'body',
    linkCommentText: null,
    mediaUrl: null,
    mediaKind: null,
    mediaAltText: null,
    sourceRef: {},
    status: 'pending',
    bodyChars: BODY.length,
    maxBodyChars: 3000,
    canPublish: false,
    composerUrl: 'https://www.linkedin.com/feed/',
    externalPostId: null,
    permalink: null,
    decidedAt: null,
    publishedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function pane(raw: SocialDraftDto, onSave: (edit: SocialDraftEdit) => Promise<void>) {
  return (
    <SocialQueuePane
      item={{ id: raw.id, title: 'Social draft', createdAt: raw.createdAt, raw }}
      pending={false}
      onApprove={() => {}}
      onDismiss={() => {}}
      onSave={onSave}
    />
  );
}

function startEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
}

function bodyBox(): HTMLTextAreaElement {
  return screen.getByLabelText<HTMLTextAreaElement>('Post');
}

describe('SocialQueuePane editing', () => {
  it('opens the fields view and seeds the textarea from the stored body', () => {
    renderWithProviders(pane(draft(), () => Promise.resolve()));

    expect(screen.queryByLabelText('Post')).toBeNull();
    startEditing();
    expect(bodyBox().value).toBe(BODY);
  });

  it('saves only the body when only the body changed', () => {
    const onSave = vi.fn(() => Promise.resolve());
    renderWithProviders(pane(draft({ linkPlacement: 'comment', linkCommentText: 'Link below.' }), onSave));

    startEditing();
    fireEvent.change(bodyBox(), { target: { value: 'A shorter post.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ body: 'A shorter post.' });
  });

  it('saves the first comment on its own when only the comment changed', () => {
    const onSave = vi.fn(() => Promise.resolve());
    renderWithProviders(pane(draft({ linkPlacement: 'comment', linkCommentText: 'Link below.' }), onSave));

    startEditing();
    fireEvent.change(screen.getByLabelText('First comment'), { target: { value: 'Full write-up:' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ linkCommentText: 'Full write-up:' });
  });

  it('offers a first comment field even when the draft has no comment text yet', () => {
    renderWithProviders(pane(draft({ linkPlacement: 'comment' }), () => Promise.resolve()));

    expect(screen.queryByText('First comment')).toBeNull();
    startEditing();
    expect(screen.getByLabelText('First comment')).toBeTruthy();
  });

  it('leaves the first comment alone on a draft whose link sits in the body', () => {
    renderWithProviders(pane(draft(), () => Promise.resolve()));

    startEditing();
    expect(screen.queryByLabelText('First comment')).toBeNull();
  });

  it('refuses to save an empty or over-long body', () => {
    renderWithProviders(pane(draft({ maxBodyChars: 20 }), () => Promise.resolve()));

    startEditing();
    fireEvent.change(bodyBox(), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(bodyBox(), { target: { value: 'far too long for this tiny limit' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('12 characters over')).toBeTruthy();

    fireEvent.change(bodyBox(), { target: { value: 'short enough' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows the unsaved body in the preview', () => {
    renderWithProviders(pane(draft(), () => Promise.resolve()));

    startEditing();
    fireEvent.change(bodyBox(), { target: { value: 'Rewritten for the preview.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByText('Rewritten for the preview.')).toBeTruthy();
  });

  it('drops the edit on cancel', () => {
    renderWithProviders(pane(draft(), () => Promise.resolve()));

    startEditing();
    fireEvent.change(bodyBox(), { target: { value: 'Never mind.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText(BODY)).toBeTruthy();
    expect(screen.queryByText('Never mind.')).toBeNull();
  });

  it('keeps an unsaved edit when the queue reloads the same draft', () => {
    const { rerender } = renderWithProviders(pane(draft(), () => Promise.resolve()));

    startEditing();
    fireEvent.change(bodyBox(), { target: { value: 'Still being written.' } });
    rerender(pane(draft(), () => Promise.resolve()));

    expect(bodyBox().value).toBe('Still being written.');
  });

  it('stays in edit mode when the save fails', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('social_invalid: nope')));
    renderWithProviders(pane(draft(), onSave));

    startEditing();
    fireEvent.change(bodyBox(), { target: { value: 'A shorter post.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await Promise.resolve();

    expect(bodyBox().value).toBe('A shorter post.');
  });
});

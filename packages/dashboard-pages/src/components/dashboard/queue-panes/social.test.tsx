import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render';
import { api as apiCall, ApiError } from '../../../api';
import type * as ApiModule from '../../../api';
import { SocialQueuePane } from './social';
import type { SocialPublishTarget } from './social-actions';
import type { SocialDraftDto, SocialDraftEdit } from './types';

vi.mock('../../../auth/use-active-role', () => ({
  useActiveMembership: () => ({ membership: { name: 'Ola Nordmann' } }),
}));

vi.mock('../../../lib/use-social-link-preview', () => ({
  useSocialLinkPreview: () => null,
}));

vi.mock('../../../i18n-navigation', () => ({
  Link: ({ href, ...rest }: { href: string } & React.ComponentProps<'a'>) => (
    <a href={href} {...rest} />
  ),
}));

const publishTargets = vi.hoisted(() => ({ current: [] as SocialPublishTarget[] }));
vi.mock('../../../lib/use-publish-target', () => ({
  useSocialPublishTargets: () => publishTargets.current,
}));

vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: vi.fn(),
}));

const api = vi.mocked(apiCall);

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

function publishablePane(onPublish: () => void) {
  const raw = draft({ canPublish: true });
  return (
    <SocialQueuePane
      item={{ id: raw.id, title: 'Social draft', createdAt: raw.createdAt, raw }}
      pending={false}
      onApprove={() => {}}
      onPublish={onPublish}
      onDismiss={() => {}}
      onSave={() => Promise.resolve()}
    />
  );
}

describe('SocialQueuePane publishing without a connected account', () => {
  beforeEach(() => {
    publishTargets.current = [];
    api.mockReset();
  });

  it('keeps Publish clickable and asks to connect instead of publishing', () => {
    const onPublish = vi.fn();
    renderWithProviders(publishablePane(onPublish));

    const publish = screen.getByRole('button', { name: /^Publish/ });
    expect(publish.hasAttribute('disabled')).toBe(false);
    fireEvent.click(publish);

    expect(onPublish).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Connect LinkedIn to publish' })).toBeTruthy();
  });

  it('starts the connection with a return path back to the draft', async () => {
    window.history.replaceState(null, '', '/dashboard/review/sod_1');
    api.mockResolvedValue({ url: 'about:blank' });
    renderWithProviders(publishablePane(() => {}));

    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect LinkedIn' }));

    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/v1/social/accounts/authorize-url', {
      method: 'POST',
      body: JSON.stringify({ platform: 'linkedin', returnTo: '/dashboard/review/sod_1' }),
    });
  });

  it('points to Integrations when the organisation has no app to connect through', async () => {
    api.mockRejectedValue(
      new ApiError({
        status: 400,
        statusText: 'Bad Request',
        endpoint: '/v1/social/accounts/authorize-url',
        method: 'POST',
        requestId: null,
        message: 'social_app_missing: no app',
        code: 'social_app_missing',
      }),
    );
    renderWithProviders(publishablePane(() => {}));

    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect LinkedIn' }));

    expect(await screen.findByRole('link', { name: 'Open Integrations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect LinkedIn' }).hasAttribute('disabled')).toBe(true);
  });

  it('publishes straight away once an account is connected', () => {
    publishTargets.current = [
      {
        userId: 'usr_1',
        platform: 'linkedin',
        authorKind: 'member',
        externalAccountId: 'member-1',
        displayName: 'Ola Nordmann',
      },
    ];
    const onPublish = vi.fn();
    renderWithProviders(publishablePane(onPublish));

    fireEvent.click(screen.getByRole('button', { name: /^Publish as/ }));

    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

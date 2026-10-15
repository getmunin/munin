import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { ReviewBroadcastPane } from './review-broadcast-pane';
import type { BroadcastDetailDto, BroadcastSummaryDto } from './queue-panes/types';
import type { QueueActionError } from './inbox-types';

function summary(over: Partial<BroadcastSummaryDto> = {}): BroadcastSummaryDto {
  return {
    id: 'obc_1',
    name: 'Changelog — October',
    status: 'pending',
    segmentId: 'cseg_1',
    channelId: 'cch_1',
    emailTemplateId: null,
    subject: 'What is new in October',
    scheduledSendAt: null,
    approvedAudienceCount: null,
    counts: { queued: 0, sent: 0, skipped: 0, failed: 0, replied: 0, unsubscribed: 0, bounced: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    decidedAt: null,
    ...over,
  };
}

function detail(eligible: number): BroadcastDetailDto {
  return {
    ...summary(),
    preheader: 'Three things shipped',
    content: { format: 'markdown', body: 'Hi {{name|there}}' },
    maxPerHour: null,
    contentFingerprint: 'f'.repeat(32),
    audience: {
      eligible,
      excluded: {
        unsubscribed: 2,
        do_not_contact: 0,
        no_lawful_basis: 1,
        no_email: 0,
        undeliverable: 0,
        duplicate_address: 0,
      },
      sample: eligible ? [{ contactId: 'cct_1', name: 'Kari Nordmann', address: 'kari@example.com' }] : [],
      frozen: false,
    },
    preview: {
      html: '<html><body><p>Hi Kari Nordmann</p></body></html>',
      text: 'Hi Kari Nordmann',
      htmlBytes: 48,
      warnings: [],
      recipient: { contactId: 'cct_1', name: 'Kari Nordmann', address: 'kari@example.com' },
    },
    proposedByActorType: 'admin_agent',
    proposedByActorId: 'agt_1',
    decidedByActorType: null,
    decidedByActorId: null,
    startedAt: null,
    completedAt: null,
    dismissReason: null,
    cancelReason: null,
    failureReason: null,
  };
}

function renderPane(props: {
  detail?: BroadcastDetailDto;
  actionError?: QueueActionError;
  onApprove?: (sendAt?: string | null) => void;
  onReload?: () => void;
}) {
  const raw = summary();
  return renderWithProviders(
    <ReviewBroadcastPane
      item={{ id: raw.id, title: raw.subject, snippet: '', createdAt: raw.createdAt, raw }}
      detail={props.detail}
      loadError={undefined}
      pending={false}
      actionError={props.actionError ?? null}
      onClearActionError={() => {}}
      onRetry={() => {}}
      onReload={props.onReload ?? (() => {})}
      onApprove={props.onApprove ?? (() => {})}
      onDismiss={() => {}}
      onSendTest={() => Promise.resolve('operator@example.com')}
    />,
  );
}

describe('ReviewBroadcastPane', () => {
  it('cannot be approved before the reviewed version has loaded', () => {
    renderPane({});
    expect(screen.getByRole('button', { name: /Send to/ }).hasAttribute('disabled')).toBe(true);
  });

  it('shows who it reaches, how many are left out, and the rendered email without scripts', () => {
    const onApprove = vi.fn();
    const { container } = renderPane({ detail: detail(412), onApprove });
    expect(screen.getByText('Goes to 412 people · 3 left out')).toBeTruthy();

    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('srcdoc')).toContain('Hi Kari Nordmann');

    fireEvent.click(screen.getByRole('button', { name: 'Send to 412 people' }));
    expect(onApprove).toHaveBeenCalledWith(null);
  });

  it('refuses to approve a broadcast nobody can receive', () => {
    renderPane({ detail: detail(0) });
    expect(screen.getByText(/Nobody in the segment can receive it right now\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send to/ }).hasAttribute('disabled')).toBe(true);
  });

  it('offers the latest version when the broadcast changed after it was opened', () => {
    const onReload = vi.fn();
    renderPane({
      detail: detail(3),
      onReload,
      actionError: {
        type: 'approve',
        itemId: 'obc_1',
        message: 'changed',
        code: 'outreach_broadcast_changed',
        attempt: 1,
      },
    });
    expect(screen.getByText('Changed since you opened it')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load latest version' }));
    expect(onReload).toHaveBeenCalled();
  });
});

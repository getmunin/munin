import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import {
  errorText,
  isProposal,
  isProposalList,
  parseToolResult,
  type Proposal,
} from '../types';

type CardState = { busy: boolean; error: string | null; dismissing: boolean; reason: string };

const IDLE: CardState = { busy: false, error: null, dismissing: false, reason: '' };

export function ProposalsView({ app, initial }: { app: McpApp; initial: Proposal[] }) {
  const [proposals, setProposals] = useState<Proposal[]>(initial);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const pending = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending');

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE), ...patch } }));
  }

  async function decide(proposal: Proposal, action: 'approve' | 'dismiss') {
    patchCard(proposal.id, { busy: true, error: null });
    const reason = cards[proposal.id]?.reason.trim();
    try {
      const result = await app.callServerTool({
        name: action === 'approve' ? 'outreach_approve_proposal' : 'outreach_dismiss_proposal',
        arguments:
          action === 'approve'
            ? { id: proposal.id }
            : { id: proposal.id, ...(reason ? { reason } : {}) },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isProposal(parsed)) {
        patchCard(proposal.id, { busy: false, error: errorText(result) });
        return;
      }
      setProposals((prev) => prev.map((p) => (p.id === parsed.id ? parsed : p)));
      patchCard(proposal.id, { busy: false, dismissing: false });
    } catch (err) {
      patchCard(proposal.id, {
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function refresh() {
    setRefreshing(true);
    setListError(null);
    try {
      const result = await app.callServerTool({
        name: 'outreach_list_proposals',
        arguments: { status: 'pending' },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isProposalList(parsed)) {
        setListError(errorText(result));
      } else {
        setProposals(parsed);
        setCards({});
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="shell">
      <header className="head">
        <div>
          <h1>Outreach proposals</h1>
          <p className="status">
            {pending.length === 0
              ? 'Nothing waiting for review.'
              : `${pending.length} waiting for review — approving sends the email.`}
          </p>
        </div>
        <button className="btn" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh pending'}
        </button>
      </header>
      {listError && <p className="status status-error">{listError}</p>}
      {pending.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          state={cards[p.id] ?? IDLE}
          onApprove={() => void decide(p, 'approve')}
          onDismiss={() => void decide(p, 'dismiss')}
          onToggleDismiss={(open) => patchCard(p.id, { dismissing: open, error: null })}
          onReason={(reason) => patchCard(p.id, { reason })}
        />
      ))}
      {decided.length > 0 && (
        <section>
          <h2>Decided</h2>
          {decided.map((p) => (
            <ProposalCard key={p.id} proposal={p} state={IDLE} />
          ))}
        </section>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  state,
  onApprove,
  onDismiss,
  onToggleDismiss,
  onReason,
}: {
  proposal: Proposal;
  state: CardState;
  onApprove?: () => void;
  onDismiss?: () => void;
  onToggleDismiss?: (open: boolean) => void;
  onReason?: (reason: string) => void;
}) {
  const contact = proposal.contact;
  const who = contact?.name || contact?.email || proposal.contactId;
  const actionable = proposal.status === 'pending' && onApprove && onDismiss;

  return (
    <article className={`card card-${proposal.status}`}>
      <div className="card-head">
        <div>
          <strong>{who}</strong>
          {contact?.email && contact.name && <span className="mute"> · {contact.email}</span>}
          <div className="mute">
            {proposal.campaign?.name ?? proposal.campaignId} · {proposal.kind}
            {proposal.proposedSendAt && ` · scheduled ${formatDate(proposal.proposedSendAt)}`}
          </div>
        </div>
        <span className={`badge badge-${proposal.status}`}>{proposal.status}</span>
      </div>
      {proposal.draftSubject && <div className="subject">{proposal.draftSubject}</div>}
      <pre className="body">{proposal.draftBody}</pre>
      {Object.keys(proposal.evidence ?? {}).length > 0 && (
        <details className="evidence">
          <summary>Evidence</summary>
          <pre className="payload">{JSON.stringify(proposal.evidence, null, 2)}</pre>
        </details>
      )}
      {proposal.status === 'dismissed' && proposal.dismissReason && (
        <p className="mute">Dismissed: {proposal.dismissReason}</p>
      )}
      {proposal.status === 'failed' && proposal.failureReason && (
        <p className="status-error">Failed: {proposal.failureReason}</p>
      )}
      {state.error && <p className="status-error">{state.error}</p>}
      {actionable && (
        <div className="actions">
          <button className="btn btn-primary" disabled={state.busy} onClick={onApprove}>
            {state.busy ? 'Working…' : 'Approve & send'}
          </button>
          {state.dismissing ? (
            <>
              <input
                className="reason"
                placeholder="Reason (optional)"
                value={state.reason}
                onChange={(e) => onReason?.(e.target.value)}
                disabled={state.busy}
              />
              <button className="btn" disabled={state.busy} onClick={onDismiss}>
                Confirm dismiss
              </button>
              <button
                className="btn btn-ghost"
                disabled={state.busy}
                onClick={() => onToggleDismiss?.(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={state.busy}
              onClick={() => onToggleDismiss?.(true)}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

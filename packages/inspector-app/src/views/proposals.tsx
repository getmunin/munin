import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import {
  errorText,
  isProposal,
  isProposalList,
  parseToolResult,
  type Proposal,
} from '../types';
import { Chrome } from '../chrome';

type CardState = {
  busy: 'approve' | 'dismiss' | null;
  error: string | null;
  decidedNow: boolean;
};

const IDLE: CardState = { busy: null, error: null, decidedNow: false };

const DISPLAY_PAGE = 25;
const REFRESH_LIMIT = 100;

export function ProposalsView({ app, initial }: { app: McpApp; initial: Proposal[] }) {
  const [proposals, setProposals] = useState<Proposal[]>(initial);
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [evidenceOpen, setEvidenceOpen] = useState<Record<string, boolean>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(DISPLAY_PAGE);

  const pendingCount = proposals.filter((p) => p.status === 'pending').length;
  const visible = proposals.slice(0, visibleCount);
  const hiddenCount = proposals.length - visible.length;

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE), ...patch } }));
  }

  async function decide(proposal: Proposal, action: 'approve' | 'dismiss') {
    patchCard(proposal.id, { busy: action, error: null });
    try {
      const result = await app.callServerTool({
        name: action === 'approve' ? 'outreach_approve_proposal' : 'outreach_dismiss_proposal',
        arguments: { id: proposal.id },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isProposal(parsed)) {
        patchCard(proposal.id, { busy: null, error: errorText(result) });
        return;
      }
      const updated = proposals.map((p) => (p.id === parsed.id ? parsed : p));
      setProposals(updated);
      patchCard(proposal.id, { busy: null, decidedNow: true });
      const idx = updated.findIndex((p) => p.id === parsed.id);
      const next =
        updated.slice(idx + 1).find((p) => p.status === 'pending') ??
        updated.slice(0, idx).find((p) => p.status === 'pending');
      if (next) {
        setOpenId(next.id);
        const nextIdx = updated.findIndex((p) => p.id === next.id);
        setVisibleCount((n) => (nextIdx >= n ? nextIdx + 1 : n));
      }
    } catch (err) {
      patchCard(proposal.id, {
        busy: null,
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
        arguments: { status: 'pending', limit: REFRESH_LIMIT },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isProposalList(parsed)) {
        setListError(errorText(result));
      } else {
        setProposals(parsed);
        setOpenId(parsed[0]?.id ?? null);
        setEvidenceOpen({});
        setCards({});
        setVisibleCount(DISPLAY_PAGE);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Chrome context="Outreach" tool="outreach_list_proposals">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">Pending proposals</div>
          <h1 className="ledger-title">Outreach proposals</h1>
          <p className="subline">
            {pendingCount === 0
              ? 'Nothing waiting — the queue is clear.'
              : `${pendingCount} waiting for review — approving sends the email.`}
          </p>
        </div>
        <button className="chip-btn" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {listError && <p className="list-error">{listError}</p>}
      {visible.map((p) => (
        <ProposalRow
          key={p.id}
          proposal={p}
          state={cards[p.id] ?? IDLE}
          open={openId === p.id}
          evidenceOpen={evidenceOpen[p.id] ?? false}
          onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
          onToggleEvidence={() =>
            setEvidenceOpen((prev) => ({ ...prev, [p.id]: !(prev[p.id] ?? false) }))
          }
          onApprove={() => void decide(p, 'approve')}
          onDismiss={() => void decide(p, 'dismiss')}
        />
      ))}
      {hiddenCount > 0 && (
        <button
          className="more-row"
          onClick={() => setVisibleCount((n) => n + DISPLAY_PAGE)}
        >
          Show {Math.min(DISPLAY_PAGE, hiddenCount)} more ({hiddenCount} hidden)
        </button>
      )}
      <div className="ledger-foot">
        {pendingCount === 0
          ? 'Queue clear'
          : `${
              hiddenCount > 0 ? `showing ${visible.length} of ${proposals.length} · ` : ''
            }${pendingCount} pending · approve sends immediately`}
      </div>
    </Chrome>
  );
}

function ProposalRow({
  proposal,
  state,
  open,
  evidenceOpen,
  onToggle,
  onToggleEvidence,
  onApprove,
  onDismiss,
}: {
  proposal: Proposal;
  state: CardState;
  open: boolean;
  evidenceOpen: boolean;
  onToggle: () => void;
  onToggleEvidence: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const contact = proposal.contact;
  const name = contact?.name || contact?.email || proposal.contactId;
  const campaignMeta = `${proposal.campaign?.name ?? proposal.campaignId} · ${proposal.kind}`;
  const hasEvidence = Object.keys(proposal.evidence ?? {}).length > 0;
  const line = decidedLine(proposal, state.decidedNow);

  return (
    <div className="row">
      <div
        className="row-grid"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`pill pill-${proposal.status}`}>
          <span className="pill-dot" />
          {proposal.status}
        </span>
        <div className="row-main">
          <div className="row-who">
            <b>{name}</b>
            {contact?.email && contact.name && <span className="mute"> · {contact.email}</span>}
          </div>
          <div className="row-subject">{proposal.draftSubject ?? '(no subject)'}</div>
        </div>
        <span className="row-age">{age(proposal.createdAt)}</span>
        <span className="row-caret">{open ? '−' : '+'}</span>
      </div>
      {open && (
        <div className="row-detail">
          <div className="draft">
            <div className="eyebrow">{campaignMeta}</div>
            {proposal.draftBody.split(/\n+/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          {hasEvidence && (
            <button className="ev-toggle" onClick={onToggleEvidence}>
              {evidenceOpen ? 'Evidence −' : 'Evidence +'}
            </button>
          )}
          {hasEvidence && evidenceOpen && (
            <pre className="evidence">{JSON.stringify(proposal.evidence, null, 2)}</pre>
          )}
          {state.error && <p className="line line-error">{state.error}</p>}
          {proposal.status === 'pending' ? (
            <div className="actions">
              <button
                className="chip-btn chip-btn-solid"
                disabled={state.busy !== null}
                onClick={onApprove}
              >
                {state.busy === 'approve' ? 'Sending…' : 'Approve & send'}
              </button>
              <button className="chip-btn" disabled={state.busy !== null} onClick={onDismiss}>
                {state.busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
              </button>
            </div>
          ) : (
            line && <p className={`line ${line.className}`}>{line.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

function decidedLine(
  proposal: Proposal,
  decidedNow: boolean,
): { text: string; className: string } | null {
  switch (proposal.status) {
    case 'sent':
      return { text: decidedNow ? 'Sent just now.' : 'Sent.', className: 'line-accent' };
    case 'approved':
      return { text: 'Approved.', className: 'line-accent' };
    case 'dismissed':
      return {
        text: proposal.dismissReason
          ? `Dismissed — ${proposal.dismissReason}`
          : 'Dismissed — nothing was sent.',
        className: 'line-mute',
      };
    case 'failed':
      return {
        text: proposal.failureReason ? `Failed — ${proposal.failureReason}` : 'Failed.',
        className: 'line-error',
      };
    default:
      return null;
  }
}

function age(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

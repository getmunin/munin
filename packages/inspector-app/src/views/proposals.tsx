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
import { useI18n, type Translator } from '../i18n';

type CardState = {
  busy: 'approve' | 'dismiss' | null;
  error: string | null;
  decidedNow: boolean;
};

const IDLE: CardState = { busy: null, error: null, decidedNow: false };

const DISPLAY_PAGE = 25;
const REFRESH_LIMIT = 100;

export function ProposalsView({ app, initial }: { app: McpApp; initial: Proposal[] }) {
  const { t } = useI18n();
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

  const foot =
    pendingCount === 0
      ? t('proposals.footClear')
      : [
          hiddenCount > 0
            ? t('proposals.footShowing', { visible: visible.length, total: proposals.length })
            : null,
          t('proposals.footPending', { count: pendingCount }),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Chrome context={t('chrome.contextOutreach')} tool="outreach_list_proposals">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">{t('proposals.eyebrow')}</div>
          <h1 className="ledger-title">{t('proposals.title')}</h1>
          <p className="subline">
            {pendingCount === 0
              ? t('proposals.sublineEmpty')
              : t('proposals.sublinePending', { count: pendingCount })}
          </p>
        </div>
        <button className="chip-btn" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? t('proposals.refreshing') : t('proposals.refresh')}
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
          {t('proposals.showMore', {
            count: Math.min(DISPLAY_PAGE, hiddenCount),
            hidden: hiddenCount,
          })}
        </button>
      )}
      <div className="ledger-foot">{foot}</div>
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
  const { locale, t } = useI18n();
  const contact = proposal.contact;
  const name = contact?.name || contact?.email || proposal.contactId;
  const campaignMeta = `${proposal.campaign?.name ?? proposal.campaignId} · ${proposal.kind}`;
  const hasEvidence = Object.keys(proposal.evidence ?? {}).length > 0;
  const line = decidedLine(proposal, state.decidedNow, t);

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
          {t(`proposals.status.${proposal.status}`)}
        </span>
        <div className="row-main">
          <div className="row-who">
            <b>{name}</b>
            {contact?.email && contact.name && <span className="mute"> · {contact.email}</span>}
          </div>
          <div className="row-subject">{proposal.draftSubject ?? t('proposals.noSubject')}</div>
        </div>
        <span className="row-age">{age(proposal.createdAt, locale, t)}</span>
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
              {evidenceOpen ? t('proposals.evidenceHide') : t('proposals.evidenceShow')}
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
                {state.busy === 'approve' ? t('proposals.approving') : t('proposals.approve')}
              </button>
              <button className="chip-btn" disabled={state.busy !== null} onClick={onDismiss}>
                {state.busy === 'dismiss' ? t('proposals.dismissing') : t('proposals.dismiss')}
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
  t: Translator,
): { text: string; className: string } | null {
  switch (proposal.status) {
    case 'sent':
      return {
        text: decidedNow ? t('proposals.sentNow') : t('proposals.sent'),
        className: 'line-accent',
      };
    case 'approved':
      return { text: t('proposals.approved'), className: 'line-accent' };
    case 'dismissed':
      return {
        text: proposal.dismissReason
          ? t('proposals.dismissedReason', { reason: proposal.dismissReason })
          : t('proposals.dismissed'),
        className: 'line-mute',
      };
    case 'failed':
      return {
        text: proposal.failureReason
          ? t('proposals.failedReason', { reason: proposal.failureReason })
          : t('proposals.failed'),
        className: 'line-error',
      };
    default:
      return null;
  }
}

function age(iso: string, locale: string, t: Translator): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (mins < 1) return t('proposals.ageNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { style: 'short' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.floor(hours / 24), 'day');
}

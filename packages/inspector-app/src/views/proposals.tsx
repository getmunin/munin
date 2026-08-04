import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { errorText, isProposal, parseToolResult, type Proposal } from '../types';
import { Chrome } from '../chrome';
import { formatAge, formatDateTime } from '../format';
import { useI18n, type Translator } from '../i18n';

type CardState = {
  busy: 'approve' | 'dismiss' | null;
  error: string | null;
  decidedNow: boolean;
};

const IDLE: CardState = { busy: null, error: null, decidedNow: false };

type EvidenceState = {
  loading: boolean;
  error: string | null;
  value: Record<string, unknown> | null;
};

const DISPLAY_PAGE = 25;
const REFRESH_LIMIT = 100;
const DASHBOARD_ONLY_CHANNELS = ['voice', 'sms'];

export function ProposalsView({ app, initial }: { app: McpApp; initial: Proposal[] }) {
  const { t } = useI18n();
  const [proposals, setProposals] = useState<Proposal[]>(initial);
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [evidenceOpen, setEvidenceOpen] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState<Record<string, EvidenceState>>({});
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

  async function toggleEvidence(proposal: Proposal) {
    const wasOpen = evidenceOpen[proposal.id] ?? false;
    setEvidenceOpen((prev) => ({ ...prev, [proposal.id]: !wasOpen }));
    if (wasOpen) return;
    if (proposal.evidence || evidence[proposal.id]?.value) return;
    setEvidence((prev) => ({ ...prev, [proposal.id]: { loading: true, error: null, value: null } }));
    try {
      const result = await app.callServerTool({
        name: 'outreach_get_proposal',
        arguments: { id: proposal.id },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isProposal(parsed)) {
        setEvidence((prev) => ({
          ...prev,
          [proposal.id]: { loading: false, error: errorText(result), value: null },
        }));
        return;
      }
      setEvidence((prev) => ({
        ...prev,
        [proposal.id]: { loading: false, error: null, value: parsed.evidence ?? {} },
      }));
    } catch (err) {
      setEvidence((prev) => ({
        ...prev,
        [proposal.id]: {
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          value: null,
        },
      }));
    }
  }

  async function decide(proposal: Proposal, action: 'approve' | 'dismiss') {
    patchCard(proposal.id, { busy: action, error: null });
    try {
      const result = await app.callServerTool({
        name: action === 'approve' ? 'outreach_approve_proposal' : 'outreach_dismiss_proposal',
        arguments:
          action === 'approve'
            ? { id: proposal.id, fingerprint: proposal.draftFingerprint }
            : { id: proposal.id },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isProposal(parsed)) {
        const message = errorText(result);
        if (action === 'approve') {
          await refresh();
          setOpenId(proposal.id);
        }
        patchCard(proposal.id, { busy: null, error: message });
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
      if (result.isError || !Array.isArray(parsed) || !parsed.every(isProposal)) {
        setListError(errorText(result));
      } else {
        setProposals(parsed);
        setOpenId(parsed[0]?.id ?? null);
        setEvidenceOpen({});
        setEvidence({});
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
          evidence={evidence[p.id] ?? null}
          onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
          onToggleEvidence={() => void toggleEvidence(p)}
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
  evidence,
  onToggle,
  onToggleEvidence,
  onApprove,
  onDismiss,
}: {
  proposal: Proposal;
  state: CardState;
  open: boolean;
  evidenceOpen: boolean;
  evidence: EvidenceState | null;
  onToggle: () => void;
  onToggleEvidence: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const { locale, t } = useI18n();
  const contact = proposal.contact;
  const name = contact?.name || contact?.email || contact?.phone || proposal.contactId;
  const campaignMeta = `${proposal.campaign?.name ?? proposal.campaignId} · ${proposal.kind}`;
  const inlineEvidence = proposal.evidence ?? evidence?.value ?? null;
  const hasEvidence = proposal.hasEvidence ?? Object.keys(proposal.evidence ?? {}).length > 0;
  const line = decidedLine(proposal, state.decidedNow, locale, t);
  const delivery = proposal.delivery;
  const isCall = delivery?.channelType === 'voice';
  const destination = delivery?.destination ?? null;
  const dashboardOnly = delivery ? DASHBOARD_ONLY_CHANNELS.includes(delivery.channelType) : false;
  const willSchedule = isFuture(proposal.proposedSendAt);

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
            {destination && contact?.name && <span className="mute"> · {destination}</span>}
          </div>
          <div className="row-subject">
            {proposal.draftSubject ?? (isCall ? t('proposals.noSubjectCall') : t('proposals.noSubject'))}
          </div>
        </div>
        <span className="row-age">{formatAge(proposal.createdAt, locale, t('proposals.ageNow'))}</span>
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
          {hasEvidence && evidenceOpen && evidence?.loading && (
            <p className="line">{t('proposals.evidenceLoading')}</p>
          )}
          {hasEvidence && evidenceOpen && evidence?.error && (
            <p className="line line-error">{evidence.error}</p>
          )}
          {hasEvidence && evidenceOpen && inlineEvidence && (
            <pre className="evidence">{JSON.stringify(inlineEvidence, null, 2)}</pre>
          )}
          {revisionNotice(proposal, t)}
          {deliveryNotice(proposal, t)}
          {scheduleNotice(proposal, locale, t)}
          {state.error && <p className="line line-error">{state.error}</p>}
          {proposal.status === 'pending' ? (
            <div className="actions">
              {!dashboardOnly && (
                <button
                  className="chip-btn chip-btn-solid"
                  disabled={state.busy !== null}
                  onClick={onApprove}
                >
                  {state.busy === 'approve'
                    ? t(willSchedule ? 'proposals.approvingScheduled' : 'proposals.approving')
                    : t(willSchedule ? 'proposals.approveScheduled' : 'proposals.approve')}
                </button>
              )}
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

function deliveryNotice(proposal: Proposal, t: Translator) {
  const delivery = proposal.delivery;
  if (!delivery || proposal.status !== 'pending') return null;
  if (!delivery.destination) {
    return (
      <p className="line line-error">
        {t(
          delivery.channelType === 'email'
            ? 'proposals.deliveryNoEmail'
            : 'proposals.deliveryNoPhone',
        )}
      </p>
    );
  }
  if (DASHBOARD_ONLY_CHANNELS.includes(delivery.channelType)) {
    return (
      <p className="line line-accent">
        {t(
          delivery.channelType === 'voice'
            ? 'proposals.dashboardOnlyCall'
            : 'proposals.dashboardOnlySms',
          { destination: delivery.destination },
        )}
      </p>
    );
  }
  const appended = [
    delivery.appendsCta ? t('proposals.deliveryAppendsCta') : null,
    delivery.appendsUnsubscribe ? t('proposals.deliveryAppendsUnsubscribe') : null,
  ].filter(Boolean);
  return (
    <p className="line line-mute">
      {t('proposals.deliveryEmail', { destination: delivery.destination })}
      {appended.length > 0 && ` ${t('proposals.deliveryAppends', { items: appended.join(', ') })}`}
    </p>
  );
}

function isFuture(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  return !Number.isNaN(at) && at > Date.now();
}

function scheduleNotice(proposal: Proposal, locale: string, t: Translator) {
  if (proposal.status !== 'pending' || !isFuture(proposal.proposedSendAt)) return null;
  return (
    <p className="line line-accent">
      {t('proposals.proposedSendAt', {
        when: formatDateTime(proposal.proposedSendAt!, locale),
      })}
    </p>
  );
}

function revisionNotice(proposal: Proposal, t: Translator) {
  if (!proposal.revisionCount) return null;
  const key = proposal.revisedAfterReviewAt
    ? 'proposals.revisedAfterReview'
    : 'proposals.revised';
  const className = proposal.revisedAfterReviewAt ? 'line line-error' : 'line line-mute';
  const notice = t(key, { count: proposal.revisionCount });
  return (
    <p className={className}>
      {proposal.lastRevisionReason ? `${notice} (${proposal.lastRevisionReason})` : notice}
    </p>
  );
}

function decidedLine(
  proposal: Proposal,
  decidedNow: boolean,
  locale: string,
  t: Translator,
): { text: string; className: string } | null {
  switch (proposal.status) {
    case 'sent':
      return {
        text: decidedNow ? t('proposals.sentNow') : t('proposals.sent'),
        className: 'line-accent',
      };
    case 'approved':
      return {
        text: proposal.scheduledSendAt
          ? t('proposals.approvedScheduled', {
              when: formatDateTime(proposal.scheduledSendAt, locale),
            })
          : t('proposals.approved'),
        className: 'line-accent',
      };
    case 'dismissed':
      return {
        text: proposal.dismissReason
          ? t('proposals.dismissedReason', { reason: proposal.dismissReason })
          : t('proposals.dismissed'),
        className: 'line-mute',
      };
    case 'withdrawn':
      return {
        text: proposal.withdrawReason
          ? t('proposals.withdrawnReason', { reason: proposal.withdrawReason })
          : t('proposals.withdrawn'),
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

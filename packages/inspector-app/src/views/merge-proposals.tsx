import { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import {
  errorText,
  isMergeProposal,
  parseToolResult,
  type MergeContact,
  type MergeProposal,
} from '../types';
import { Chrome } from '../chrome';
import { formatAge } from '../format';
import { useI18n, type Translator } from '../i18n';

type CardState = {
  busy: 'apply' | 'dismiss' | null;
  error: string | null;
  decidedNow: boolean;
};

const IDLE: CardState = { busy: null, error: null, decidedNow: false };

const REFRESH_LIMIT = 100;

const COMPARED_FIELDS = ['name', 'email', 'phone', 'companyId', 'endUserId'] as const;

export function MergeProposalsView({ app, initial }: { app: McpApp; initial: MergeProposal[] }) {
  const { t } = useI18n();
  const [proposals, setProposals] = useState<MergeProposal[]>(initial);
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [evidenceOpen, setEvidenceOpen] = useState<Record<string, boolean>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const pendingCount = proposals.filter((p) => p.status === 'pending').length;

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE), ...patch } }));
  }

  async function decide(proposal: MergeProposal, action: 'apply' | 'dismiss') {
    patchCard(proposal.id, { busy: action, error: null });
    try {
      const result = await app.callServerTool({
        name: action === 'apply' ? 'crm_apply_merge_proposal' : 'crm_dismiss_merge_proposal',
        arguments: { id: proposal.id },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !isMergeProposal(parsed)) {
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
      if (next) setOpenId(next.id);
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
        name: 'crm_list_merge_proposals',
        arguments: { status: 'pending', limit: REFRESH_LIMIT },
      });
      const parsed = parseToolResult(result);
      if (result.isError || !Array.isArray(parsed) || !parsed.every(isMergeProposal)) {
        setListError(errorText(result));
      } else {
        setProposals(parsed);
        setOpenId(parsed[0]?.id ?? null);
        setEvidenceOpen({});
        setCards({});
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Chrome context={t('chrome.contextCrm')} tool="crm_list_merge_proposals">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">{t('merge.eyebrow')}</div>
          <h1 className="ledger-title">{t('merge.title')}</h1>
          <p className="subline">
            {pendingCount === 0
              ? t('merge.sublineEmpty')
              : t('merge.sublinePending', { count: pendingCount })}
          </p>
        </div>
        <button className="chip-btn" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? t('merge.refreshing') : t('merge.refresh')}
        </button>
      </div>
      {listError && <p className="list-error">{listError}</p>}
      {proposals.map((p) => (
        <MergeRow
          key={p.id}
          proposal={p}
          state={cards[p.id] ?? IDLE}
          open={openId === p.id}
          evidenceOpen={evidenceOpen[p.id] ?? false}
          onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
          onToggleEvidence={() =>
            setEvidenceOpen((prev) => ({ ...prev, [p.id]: !(prev[p.id] ?? false) }))
          }
          onApply={() => void decide(p, 'apply')}
          onDismiss={() => void decide(p, 'dismiss')}
        />
      ))}
      <div className="ledger-foot">
        {pendingCount === 0 ? t('merge.footClear') : t('merge.footPending', { count: pendingCount })}
      </div>
    </Chrome>
  );
}

function contactLabel(contact: MergeContact, t: Translator): string {
  return contact.name || contact.email || contact.phone || t('merge.unnamedContact');
}

function MergeRow({
  proposal,
  state,
  open,
  evidenceOpen,
  onToggle,
  onToggleEvidence,
  onApply,
  onDismiss,
}: {
  proposal: MergeProposal;
  state: CardState;
  open: boolean;
  evidenceOpen: boolean;
  onToggle: () => void;
  onToggleEvidence: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { locale, t } = useI18n();
  const keeper =
    proposal.recommendedKeeperId === proposal.contactB.id ? proposal.contactB : proposal.contactA;
  const duplicate = keeper === proposal.contactA ? proposal.contactB : proposal.contactA;
  const hasEvidence = Object.keys(proposal.evidence ?? {}).length > 0;
  const patchEntries = Object.entries(proposal.recommendedPatch ?? {});
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
          {t(`merge.status.${proposal.status}`)}
        </span>
        <div className="row-main">
          <div className="row-who">
            <b>{contactLabel(proposal.contactA, t)}</b>
            <span className="mute"> × </span>
            <b>{contactLabel(proposal.contactB, t)}</b>
          </div>
          <div className="row-subject">
            {t(`merge.confidence.${proposal.confidence}`)}
            {proposal.contactA.email && proposal.contactB.email
              ? ` · ${proposal.contactA.email} / ${proposal.contactB.email}`
              : ''}
          </div>
        </div>
        <span className="row-age">{formatAge(proposal.createdAt, locale, t('merge.ageNow'))}</span>
        <span className="row-caret">{open ? '−' : '+'}</span>
      </div>
      {open && (
        <div className="row-detail">
          <table className="compare">
            <thead>
              <tr>
                <th />
                <th className={keeper === proposal.contactA ? 'compare-keeper' : undefined}>
                  {contactLabel(proposal.contactA, t)}
                  {keeper === proposal.contactA && (
                    <span className="keeper-tag">{t('merge.keeper')}</span>
                  )}
                </th>
                <th className={keeper === proposal.contactB ? 'compare-keeper' : undefined}>
                  {contactLabel(proposal.contactB, t)}
                  {keeper === proposal.contactB && (
                    <span className="keeper-tag">{t('merge.keeper')}</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARED_FIELDS.map((field) => {
                const a = proposal.contactA[field];
                const b = proposal.contactB[field];
                const conflict = a !== null && b !== null && a !== b;
                return (
                  <tr key={field} className={conflict ? 'compare-conflict' : undefined}>
                    <td className="compare-field">{t(`merge.field.${field}`)}</td>
                    <td className={keeper === proposal.contactA ? 'compare-keeper' : undefined}>
                      {a ?? <span className="mute">—</span>}
                    </td>
                    <td className={keeper === proposal.contactB ? 'compare-keeper' : undefined}>
                      {b ?? <span className="mute">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {patchEntries.length > 0 && (
            <p className="merge-patch">
              {t('merge.patchIntro', { name: contactLabel(duplicate, t) })}{' '}
              <span className="merge-patch-fields">
                {patchEntries.map(([key]) => key).join(', ')}
              </span>
            </p>
          )}
          {hasEvidence && (
            <button className="ev-toggle" onClick={onToggleEvidence}>
              {evidenceOpen ? t('merge.evidenceHide') : t('merge.evidenceShow')}
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
                onClick={onApply}
              >
                {state.busy === 'apply' ? t('merge.applying') : t('merge.apply')}
              </button>
              <button className="chip-btn" disabled={state.busy !== null} onClick={onDismiss}>
                {state.busy === 'dismiss' ? t('merge.dismissing') : t('merge.dismiss')}
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
  proposal: MergeProposal,
  decidedNow: boolean,
  t: Translator,
): { text: string; className: string } | null {
  switch (proposal.status) {
    case 'applied':
      return {
        text: decidedNow ? t('merge.appliedNow') : t('merge.applied'),
        className: 'line-accent',
      };
    case 'dismissed':
      return {
        text: proposal.dismissReason
          ? t('merge.dismissedReason', { reason: proposal.dismissReason })
          : t('merge.dismissed'),
        className: 'line-mute',
      };
    default:
      return null;
  }
}

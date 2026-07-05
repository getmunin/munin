import { useEffect, useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import {
  errorText,
  isCurationCandidate,
  isKbDocument,
  isKbSpaceList,
  parseToolResult,
  type CurationCandidate,
  type KbSpace,
} from '../types';
import { Chrome } from '../chrome';
import { formatAge } from '../format';
import { useI18n } from '../i18n';

type Decision = { kind: 'published' | 'dismissed'; detail: string | null };

type CardState = {
  busy: 'publish' | 'dismiss' | null;
  error: string | null;
  decision: Decision | null;
};

const IDLE: CardState = { busy: null, error: null, decision: null };

const CURATION_INBOX_SLUG = 'kb-curation-inbox';

export function CurationView({ app, initial }: { app: McpApp; initial: CurationCandidate[] }) {
  const { locale, t } = useI18n();
  const [candidates, setCandidates] = useState<CurationCandidate[]>(initial);
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [bodies, setBodies] = useState<Record<string, string | null>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [spaces, setSpaces] = useState<KbSpace[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const pendingCount = candidates.filter((c) => !(cards[c.id]?.decision)).length;

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE), ...patch } }));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await app.callServerTool({ name: 'kb_list_spaces', arguments: {} });
        const parsed = parseToolResult(result);
        if (!cancelled && !result.isError && Array.isArray(parsed)) {
          const rows = (isKbSpaceList(parsed) ? parsed : []).filter(
            (s) => s.slug !== CURATION_INBOX_SLUG,
          );
          setSpaces(rows);
        } else if (!cancelled) {
          setSpaces([]);
        }
      } catch {
        if (!cancelled) setSpaces([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app]);

  useEffect(() => {
    if (!openId || bodies[openId] !== undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await app.callServerTool({
          name: 'kb_get_document',
          arguments: { id: openId },
        });
        const parsed = parseToolResult(result);
        if (!cancelled) {
          setBodies((prev) => ({
            ...prev,
            [openId]: !result.isError && isKbDocument(parsed) ? parsed.body : null,
          }));
        }
      } catch {
        if (!cancelled) setBodies((prev) => ({ ...prev, [openId]: null }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, openId, bodies]);

  function targetFor(candidate: CurationCandidate): string {
    const chosen = targets[candidate.id];
    if (chosen !== undefined) return chosen;
    if (candidate.proposedTargetSpaceSlug) return candidate.proposedTargetSpaceSlug;
    return spaces?.[0]?.slug ?? '';
  }

  async function publish(candidate: CurationCandidate) {
    const targetSpaceSlug = targetFor(candidate);
    if (!targetSpaceSlug) {
      patchCard(candidate.id, { error: t('curation.noTarget') });
      return;
    }
    patchCard(candidate.id, { busy: 'publish', error: null });
    try {
      const result = await app.callServerTool({
        name: 'kb_publish_curation_candidate',
        arguments: { candidateDocumentId: candidate.id, targetSpaceSlug },
      });
      if (result.isError) {
        patchCard(candidate.id, { busy: null, error: errorText(result) });
        return;
      }
      patchCard(candidate.id, {
        busy: null,
        decision: { kind: 'published', detail: targetSpaceSlug },
      });
      advance(candidate.id);
    } catch (err) {
      patchCard(candidate.id, {
        busy: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function dismiss(candidate: CurationCandidate) {
    patchCard(candidate.id, { busy: 'dismiss', error: null });
    try {
      const result = await app.callServerTool({
        name: 'kb_delete_document',
        arguments: { id: candidate.id },
      });
      if (result.isError) {
        patchCard(candidate.id, { busy: null, error: errorText(result) });
        return;
      }
      patchCard(candidate.id, { busy: null, decision: { kind: 'dismissed', detail: null } });
      advance(candidate.id);
    } catch (err) {
      patchCard(candidate.id, {
        busy: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function advance(fromId: string) {
    setCards((current) => {
      const idx = candidates.findIndex((c) => c.id === fromId);
      const undecided = (c: CurationCandidate) => !current[c.id]?.decision && c.id !== fromId;
      const next = candidates.slice(idx + 1).find(undecided) ?? candidates.slice(0, idx).find(undecided);
      if (next) setOpenId(next.id);
      return current;
    });
  }

  async function refresh() {
    setRefreshing(true);
    setListError(null);
    try {
      const result = await app.callServerTool({
        name: 'kb_list_curation_candidates',
        arguments: {},
      });
      const parsed = parseToolResult(result);
      if (result.isError || !Array.isArray(parsed) || !parsed.every(isCurationCandidate)) {
        setListError(errorText(result));
      } else {
        setCandidates(parsed);
        setOpenId(parsed[0]?.id ?? null);
        setCards({});
        setBodies({});
        setTargets({});
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Chrome context={t('chrome.contextKb')} tool="kb_list_curation_candidates">
      <div className="ledger-head">
        <div>
          <div className="eyebrow eyebrow-accent">{t('curation.eyebrow')}</div>
          <h1 className="ledger-title">{t('curation.title')}</h1>
          <p className="subline">
            {pendingCount === 0
              ? t('curation.sublineEmpty')
              : t('curation.sublinePending', { count: pendingCount })}
          </p>
        </div>
        <button className="chip-btn" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? t('curation.refreshing') : t('curation.refresh')}
        </button>
      </div>
      {listError && <p className="list-error">{listError}</p>}
      {candidates.map((candidate) => {
        const state = cards[candidate.id] ?? IDLE;
        const open = openId === candidate.id;
        const body = bodies[candidate.id];
        return (
          <div className="row" key={candidate.id}>
            <div
              className="row-grid"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId((cur) => (cur === candidate.id ? null : candidate.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenId((cur) => (cur === candidate.id ? null : candidate.id));
                }
              }}
            >
              <span className={`pill pill-${state.decision ? state.decision.kind : 'pending'}`}>
                <span className="pill-dot" />
                {t(`curation.status.${state.decision ? state.decision.kind : 'pending'}`)}
              </span>
              <div className="row-main">
                <div className="row-who">
                  <b>{candidate.title}</b>
                </div>
                <div className="row-subject">
                  {candidate.proposedTargetSpaceSlug
                    ? t('curation.proposedTarget', { space: candidate.proposedTargetSpaceSlug })
                    : t('curation.noProposedTarget')}
                  {candidate.sourceConversationId &&
                    ` · ${t('curation.fromConversation', { id: candidate.sourceConversationId })}`}
                </div>
              </div>
              <span className="row-age">
                {formatAge(candidate.updatedAt, locale, t('curation.ageNow'))}
              </span>
              <span className="row-caret">{open ? '−' : '+'}</span>
            </div>
            {open && (
              <div className="row-detail">
                <div className="draft">
                  <div className="eyebrow">{t('curation.draftEyebrow')}</div>
                  {body === undefined ? (
                    <p className="mute">{t('curation.loadingBody')}</p>
                  ) : body === null ? (
                    <p className="mute">{t('curation.bodyFailed')}</p>
                  ) : (
                    body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)
                  )}
                </div>
                {state.error && <p className="line line-error">{state.error}</p>}
                {state.decision ? (
                  <p className={`line ${state.decision.kind === 'published' ? 'line-accent' : 'line-mute'}`}>
                    {state.decision.kind === 'published'
                      ? t('curation.published', { space: state.decision.detail ?? '' })
                      : t('curation.dismissed')}
                  </p>
                ) : (
                  <div className="actions actions-wrap">
                    <label className="target-label">
                      {t('curation.targetLabel')}
                      {spaces && spaces.length > 0 ? (
                        <select
                          className="target-select"
                          value={targetFor(candidate)}
                          onChange={(e) =>
                            setTargets((prev) => ({ ...prev, [candidate.id]: e.target.value }))
                          }
                        >
                          {candidate.proposedTargetSpaceSlug &&
                            !spaces.some((s) => s.slug === candidate.proposedTargetSpaceSlug) && (
                              <option value={candidate.proposedTargetSpaceSlug}>
                                {candidate.proposedTargetSpaceSlug}
                              </option>
                            )}
                          {spaces.map((s) => (
                            <option key={s.id} value={s.slug}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="target-select"
                          value={targetFor(candidate)}
                          placeholder={t('curation.targetPlaceholder')}
                          onChange={(e) =>
                            setTargets((prev) => ({ ...prev, [candidate.id]: e.target.value }))
                          }
                        />
                      )}
                    </label>
                    <button
                      className="chip-btn chip-btn-solid"
                      disabled={state.busy !== null}
                      onClick={() => void publish(candidate)}
                    >
                      {state.busy === 'publish' ? t('curation.publishing') : t('curation.publish')}
                    </button>
                    <button
                      className="chip-btn"
                      disabled={state.busy !== null}
                      onClick={() => void dismiss(candidate)}
                    >
                      {state.busy === 'dismiss' ? t('curation.dismissing') : t('curation.dismiss')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="ledger-foot">
        {pendingCount === 0
          ? t('curation.footClear')
          : t('curation.footPending', { count: pendingCount })}
      </div>
    </Chrome>
  );
}

'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Label } from '@getmunin/ui';
import { NativeSelect } from '../native-select';
import { useConfirm } from '../confirm-dialog';
import { useTranslateError, getErrorCode } from '../../i18n/translate-error';
import { JourneyNodeSchema } from '@getmunin/types';
import { JourneyGraph, layoutJourney } from './journey-graph';
import {
  NEW_STEP_KINDS,
  edgeFieldsFor,
  insertAfter,
  isNodeId,
  nodesWithErrors,
  parseNodeJson,
  autoAllowed,
  setContent,
  setField,
  setMessageClass,
  skeletonNode,
  specNodes,
  suggestNodeId,
  type DraftEdit,
  type JourneyNodeRecord,
  type NewStepKind,
} from './draft-edit';
import type { JourneyValidation, JourneyVersionDto } from './journey-types';

const textareaClass =
  'w-full rounded-input border border-rule-soft bg-paper px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:border-cobalt dark:border-rule-on-dark dark:bg-card';

export function DraftEditor({
  version,
  edit,
  validate,
  onStale,
}: {
  version: JourneyVersionDto;
  edit: (change: DraftEdit, ifSpecHash: string) => Promise<JourneyVersionDto>;
  validate: (versionNumber: number) => Promise<JourneyValidation>;
  onStale: () => void;
}) {
  const t = useTranslations('dashboard.journeys.editor');
  const translateError = useTranslateError();
  const confirm = useConfirm();
  const [current, setCurrent] = useState(version);
  const [validation, setValidation] = useState<JourneyValidation | null>(version.validation);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<JourneyNodeRecord | null>(null);
  const [json, setJson] = useState('');
  const [newKind, setNewKind] = useState<NewStepKind>('email');
  const [newId, setNewId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(version);
    setValidation(version.validation);
  }, [version]);

  const nodes = useMemo(() => specNodes(current.spec), [current.spec]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    setForm(selected);
    setJson(selected ? JSON.stringify(selected, null, 2) : '');
  }, [selected]);

  useEffect(() => {
    setNewId(suggestNodeId(newKind, nodes.map((n) => n.id)));
  }, [newKind, nodes]);

  async function apply(change: DraftEdit, select: string | null) {
    setBusy(true);
    setError(null);
    try {
      const saved = await edit(change, current.specHash);
      setCurrent(saved);
      setSelectedId(select);
      setValidation(await validate(saved.number));
    } catch (err) {
      setError(translateError(err));
      if (getErrorCode(err) === 'journeys_draft_changed') onStale();
    } finally {
      setBusy(false);
    }
  }

  function saveForm() {
    if (!form) return;
    const checked = JourneyNodeSchema.safeParse(form);
    if (!checked.success) {
      const detail = checked.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || form.id}: ${i.message}`)
        .join('; ');
      setError(t('formInvalid', { detail }));
      return;
    }
    void apply({ kind: 'updateNode', node: form }, form.id);
  }

  function saveJson() {
    if (!selected) return;
    const parsed = parseNodeJson(json, selected.id);
    if ('error' in parsed) {
      setError(t(`jsonError.${parsed.error}`));
      return;
    }
    void apply({ kind: 'updateNode', node: parsed.node }, selected.id);
  }

  async function remove() {
    if (!selected) return;
    const ok = await confirm({
      title: t('removeTitle', { id: selected.id }),
      message: t('removeBody'),
      confirmLabel: t('remove'),
      cancelLabel: t('cancel'),
      destructive: true,
    });
    if (ok) void apply({ kind: 'removeNode', nodeId: selected.id }, null);
  }

  function add() {
    if (!isNodeId(newId)) {
      setError(t('badId'));
      return;
    }
    const name = (fallback?: string) => `{{name${fallback ? `|${fallback}` : ''}}}`;
    const copy = {
      subject: t('skeleton.subject'),
      emailBody: t('skeleton.emailBody', { name: name() }),
      smsBody: t('skeleton.smsBody', { name: name(t('skeleton.fallbackName')) }),
      chatBody: t('skeleton.chatBody', { name: name(t('skeleton.fallbackName')) }),
      voiceBody: t('skeleton.voiceBody'),
      approvalTitle: t('skeleton.approvalTitle'),
    };
    const placed = insertAfter(selected, skeletonNode(newKind, newId, copy));
    void apply({ kind: 'addNode', node: placed.node, after: placed.after }, newId);
  }

  const errorIds = nodesWithErrors(validation);
  const drawable = layoutJourney(current.spec) !== null;
  const otherIds = nodes.map((n) => n.id).filter((id) => id !== selected?.id);
  const channel = typeof form?.channel === 'string' ? form.channel : 'email';
  const content = (form?.content as { subject?: string; body?: string } | undefined) ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        {drawable ? (
          <JourneyGraph
            spec={current.spec}
            highlight={selectedId}
            errorIds={errorIds}
            onSelect={setSelectedId}
            emptyLabel={t('graphInvalid')}
          />
        ) : (
          <div className="rounded-card border-[1px] border-rule-soft p-4 dark:border-rule-on-dark">
            <p className="font-mono text-xs text-ink-mute">{t('graphInvalid')}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {nodes.map((n) => (
                <li key={n.id}>
                  <Button
                    size="sm"
                    variant={n.id === selectedId ? 'accent' : 'outline'}
                    aria-pressed={n.id === selectedId}
                    onClick={() => setSelectedId(n.id)}
                  >
                    {n.id}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {validation && validation.errors.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-destructive">
            {validation.errors.map((e, i) => (
              <li key={`${e.code}-${i}`}>
                {e.nodeId && <code>{e.nodeId}</code>} {e.message}
              </li>
            ))}
          </ul>
        )}
        {validation?.valid && <p className="mt-3 text-xs text-ink-mute">{t('valid')}</p>}
      </div>

      <aside className="space-y-4 rounded-card border-[1px] border-rule-soft p-4 dark:border-rule-on-dark">
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {!form ? (
          <p className="text-xs text-ink-mute">{t('pickStep')}</p>
        ) : (
          <div className="space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-label">
              {form.type === 'message' ? `${form.type} · ${channel}` : form.type} · {form.id}
            </p>
            <Field label={t('label')}>
              <Input
                value={typeof form.label === 'string' ? form.label : ''}
                onChange={(e) => setForm(setField(form, 'label', e.target.value))}
              />
            </Field>
            {form.type === 'message' && (
              <>
                {channel === 'email' && (
                  <Field label={t('subject')}>
                    <Input value={content.subject ?? ''} onChange={(e) => setForm(setContent(form, 'subject', e.target.value))} />
                  </Field>
                )}
                <Field label={t(form.draftBy === 'agent' ? 'referenceBody' : 'body')}>
                  <textarea
                    aria-label={t('body')}
                    rows={6}
                    className={textareaClass}
                    value={content.body ?? ''}
                    onChange={(e) => setForm(setContent(form, 'body', e.target.value))}
                  />
                </Field>
                {form.draftBy === 'agent' && (
                  <Field label={t('brief')}>
                    <textarea
                      rows={3}
                      className={textareaClass}
                      value={typeof form.brief === 'string' ? form.brief : ''}
                      onChange={(e) => setForm(setField(form, 'brief', e.target.value))}
                    />
                  </Field>
                )}
                {channel !== 'voice' && (
                  <Field label={t('messageClass')}>
                    <NativeSelect
                      value={form.class === 'transactional' ? 'transactional' : 'marketing'}
                      onChange={(e) => setForm(setMessageClass(form, e.target.value))}
                    >
                      <option value="marketing">{t('classMode.marketing')}</option>
                      <option value="transactional">{t('classMode.transactional')}</option>
                    </NativeSelect>
                  </Field>
                )}
                <Field label={t('approval')}>
                  <NativeSelect
                    value={typeof form.approval === 'string' ? form.approval : 'draft_only'}
                    onChange={(e) => setForm(setField(form, 'approval', e.target.value))}
                  >
                    <option value="draft_only">{t('approvalMode.draft_only')}</option>
                    {autoAllowed(form) && <option value="auto">{t('approvalMode.auto')}</option>}
                    <option value="off">{t('approvalMode.off')}</option>
                  </NativeSelect>
                </Field>
              </>
            )}
            {form.type === 'wait' && (
              <Field label={t('duration')}>
                <Input
                  value={typeof form.duration === 'string' ? form.duration : ''}
                  onChange={(e) => setForm(setField(form, 'duration', e.target.value))}
                />
              </Field>
            )}
            {form.type === 'wait_for' && (
              <>
                <Field label={t('event')}>
                  <Input value={typeof form.event === 'string' ? form.event : ''} onChange={(e) => setForm(setField(form, 'event', e.target.value))} />
                </Field>
                <Field label={t('timeout')}>
                  <Input value={typeof form.timeout === 'string' ? form.timeout : ''} onChange={(e) => setForm(setField(form, 'timeout', e.target.value))} />
                </Field>
              </>
            )}
            {edgeFieldsFor(form).map((field) => (
              <Field key={field} label={t(`edge.${field}`)}>
                <NativeSelect
                  value={typeof form[field] === 'string' ? form[field] : ''}
                  onChange={(e) => setForm(setField(form, field, e.target.value))}
                >
                  <option value="">{t('noEdge')}</option>
                  {otherIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="accent" disabled={busy} onClick={saveForm}>
                {t('save')}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>
                {t('remove')}
              </Button>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-ink-mute">{t('advanced')}</summary>
              <textarea
                aria-label={t('advanced')}
                rows={12}
                className={`${textareaClass} mt-2`}
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
              <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={saveJson}>
                {t('saveJson')}
              </Button>
            </details>
          </div>
        )}

        <div className="space-y-2 border-t-[1px] border-rule-soft pt-4 dark:border-rule-on-dark">
          <p className="text-xs font-medium">{selected ? t('addAfter', { id: selected.id }) : t('addLoose')}</p>
          <NativeSelect aria-label={t('stepKind')} value={newKind} onChange={(e) => setNewKind(e.target.value as NewStepKind)}>
            {NEW_STEP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kind.${kind}`)}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label={t('newId')} value={newId} onChange={(e) => setNewId(e.target.value)} />
          <Button size="sm" variant="outline" disabled={busy} onClick={add}>
            {t('add')}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

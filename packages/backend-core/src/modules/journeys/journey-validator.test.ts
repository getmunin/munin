import { describe, expect, it } from 'vitest';
import { parseIsoDurationMs } from '@getmunin/types';
import { parseJourneySpec, validateJourneySpec, type JourneyReferences } from './journey-validator.ts';

const refs: JourneyReferences = {
  segmentIds: new Set(['seg_trial']),
  emailTemplateIds: new Set(['tpl_brand']),
  smsChannelIds: new Set(['ch_sms']),
  webhookIds: new Set(['whk_crm']),
};

function trialSpec(overrides: Record<string, unknown> = {}) {
  return {
    entry: { trigger: { type: 'event', event: 'trial.started' }, segmentId: 'seg_trial' },
    goal: { event: 'subscription.started', windowDays: 30 },
    settings: { quietHours: '20:00-08:00', timezone: 'Europe/Oslo' },
    start: 'welcome',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        channel: 'email',
        content: { subject: 'Velkommen', body: 'Hei {{name}}', templateId: 'tpl_brand' },
        next: 'wait5',
      },
      { id: 'wait5', type: 'wait', duration: 'P5D', validDays: ['mon', 'tue', 'wed', 'thu', 'fri'], next: 'invited' },
      {
        id: 'invited',
        type: 'branch',
        rules: [{ if: { event: 'teammate.invited', since: 'entry' }, next: 'done' }],
        default: 'tag_stuck',
      },
      { id: 'tag_stuck', type: 'action', action: 'crm.add_tag', params: { tag: 'trial-stuck' }, next: 'done' },
      { id: 'done', type: 'exit' },
    ],
    ...overrides,
  };
}

function check(input: unknown) {
  const parsed = parseJourneySpec(input);
  if (!parsed.spec) return parsed.validation;
  return validateJourneySpec(parsed.spec, refs);
}

const codes = (input: unknown) => check(input).errors.map((e) => e.code);

describe('journey validator', () => {
  it('accepts a well-formed trial onboarding journey', () => {
    const result = check(trialSpec());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('applies defaults so the runtime never sees missing settings', () => {
    const parsed = parseJourneySpec(trialSpec());
    expect(parsed.spec?.entry.reentry).toBe('once_at_a_time');
    expect(parsed.spec?.settings.maxVisitsPerNode).toBe(3);
    const welcome = parsed.spec?.nodes[0];
    expect(welcome?.type === 'message' && welcome.approval).toBe('draft_only');
  });

  it('reports schema problems with their path', () => {
    const result = check(trialSpec({ start: 'Not Valid' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: 'schema', path: 'start' });
  });

  it('flags dangling edges, unreachable nodes and a missing start', () => {
    const spec = trialSpec();
    spec.nodes.push({ id: 'orphan', type: 'exit' });
    (spec.nodes[1] as { next: string }).next = 'nowhere';
    expect(codes(spec)).toEqual(expect.arrayContaining(['dangling_edge', 'unreachable_node']));
    expect(codes(trialSpec({ start: 'missing' }))).toContain('missing_start');
  });

  it('rejects an approval step that does not say what to approve', () => {
    const spec = trialSpec();
    spec.nodes.splice(2, 1, { id: 'invited', type: 'approval', next: 'done' } as never);
    expect(codes(spec)).toContain('schema');
  });

  it('rejects a loop that never waits but allows one that does', () => {
    const tight = trialSpec();
    tight.nodes.splice(3, 1, { id: 'tag_stuck', type: 'jump', to: 'invited' } as never);
    expect(codes(tight)).toContain('loop_without_wait');

    const patient = trialSpec();
    patient.nodes.splice(3, 1, { id: 'tag_stuck', type: 'jump', to: 'wait5' } as never);
    expect(codes(patient)).not.toContain('loop_without_wait');
  });

  it('checks references, split totals, wait modes and action params', () => {
    const spec = trialSpec({ entry: { trigger: { type: 'event', event: 'trial.started' }, segmentId: 'seg_gone' } });
    (spec.nodes[0] as { content: { templateId: string } }).content.templateId = 'tpl_gone';
    spec.nodes.splice(
      3,
      1,
      { id: 'tag_stuck', type: 'split', paths: [{ name: 'a', percent: 60, next: 'hook' }, { name: 'b', percent: 30, next: 'done' }] } as never,
      { id: 'hook', type: 'action', action: 'webhook.post', params: { webhookId: 'whk_gone' }, next: 'pause' } as never,
      { id: 'pause', type: 'wait', duration: 'P1D', until: '2026-12-01T09:00:00+01:00', next: 'done' } as never,
    );
    expect(codes(spec)).toEqual(
      expect.arrayContaining(['unknown_segment', 'unknown_template', 'split_total', 'action_params', 'wait_mode']),
    );
  });

  it('requires a goal and forbids entering on journey events', () => {
    const spec = trialSpec({ entry: { trigger: { type: 'event', event: 'journey.exited' } } });
    delete (spec as { goal?: unknown }).goal;
    expect(codes(spec)).toEqual(expect.arrayContaining(['missing_goal', 'self_trigger']));
  });

  it('accepts an agent decide node and checks its fallback edge', () => {
    const agent = {
      id: 'invited',
      type: 'agent',
      mode: 'decide',
      instructions: 'Is this trial user likely to buy?',
      edges: { likely: 'tag_stuck', unlikely: 'done' },
      fallback: 'unlikely',
      inputs: ['contact', 'events'],
    };
    const ok = trialSpec();
    ok.nodes.splice(2, 1, agent as never);
    expect(codes(ok)).toEqual([]);
    const parsed = parseJourneySpec(ok);
    expect(parsed.spec?.nodes[2]).toMatchObject({ timeout: 'PT10M' });

    const bad = trialSpec();
    bad.nodes.splice(2, 1, { ...agent, fallback: 'maybe' } as never);
    expect(codes(bad)).toContain('agent_fallback');

    const noModel = validateJourneySpec(parseJourneySpec(ok).spec!, { ...refs, llmConfigured: false });
    expect(noModel.warnings.map((w) => w.code)).toContain('agent_without_model');
  });

  it('warns about a wait_for without a timeout path', () => {
    const spec = trialSpec();
    spec.nodes.splice(1, 1, { id: 'wait5', type: 'wait_for', event: 'teammate.invited', timeout: 'P5D', next: 'invited' } as never);
    expect(check(spec).warnings.map((w) => w.code)).toContain('timeout_ends_journey');
  });

  it('parses ISO durations', () => {
    expect(parseIsoDurationMs('P5D')).toBe(5 * 86_400_000);
    expect(parseIsoDurationMs('PT2H30M')).toBe(150 * 60_000);
    expect(parseIsoDurationMs('P1W')).toBe(7 * 86_400_000);
    expect(parseIsoDurationMs('5 days')).toBeNull();
  });

  it('keeps SMS steps short, plain and approved by a person, with an SMS channel to send from', () => {
    const sms = (extra: Record<string, unknown> = {}) =>
      ({ id: 'sms', type: 'message', channel: 'sms', content: { body: 'Hei!' }, next: 'done', ...extra });
    const spec = (node: Record<string, unknown>, smsChannelId?: string) =>
      parseJourneySpec({
        entry: { trigger: { type: 'manual' } },
        goal: { event: 'subscription.started', windowDays: 30 },
        settings: smsChannelId ? { smsChannelId } : {},
        start: 'sms',
        nodes: [node, { id: 'done', type: 'exit' }],
      }).spec!;
    const codes = (node: Record<string, unknown>, smsChannelId?: string) =>
      validateJourneySpec(spec(node, smsChannelId), refs).errors.map((e) => e.code);

    expect(codes(sms(), 'ch_sms')).toEqual([]);
    expect(codes(sms())).toEqual(['sms_channel']);
    expect(codes(sms(), 'ch_mail')).toEqual(['sms_channel']);
    expect(codes(sms({ approval: 'auto' }), 'ch_sms')).toEqual(['sms_auto']);
    expect(codes(sms({ approval: 'auto', class: 'transactional' }), 'ch_sms')).toEqual([]);
    expect(codes(sms({ content: { subject: 'Hei', body: 'Hei!' } }), 'ch_sms')).toEqual(['sms_content']);
    expect(codes(sms({ content: { body: 'x'.repeat(481) } }), 'ch_sms')).toEqual(['sms_length']);
    expect(codes(sms({ draftBy: 'agent', brief: 'remind' }), 'ch_sms')).toEqual([]);
    expect(codes(sms({ draftBy: 'agent' }), 'ch_sms')).toEqual(['agent_draft_brief']);
    expect(codes({ id: 'sms', type: 'message', channel: 'email', content: { body: 'Hei!' }, next: 'done' })).toEqual([
      'missing_subject',
    ]);
  });

  it('allows concurrent runs only for event-triggered journeys that send nothing', () => {
    const base = (trigger: Record<string, unknown>, nodes: unknown[]) =>
      parseJourneySpec({
        entry: { trigger, reentry: 'concurrent' },
        goal: { event: 'order.completed', windowDays: 7 },
        start: nodes.length > 1 ? 'tag' : 'done',
        nodes,
      }).spec!;
    const tag = { id: 'tag', type: 'action', action: 'crm.add_tag', params: { tag: 'cart' }, next: 'done' };
    const mail = { id: 'tag', type: 'message', channel: 'email', content: { subject: 'Hei', body: 'Hei' }, next: 'done' };
    const done = { id: 'done', type: 'exit' };
    const codes = (spec: ReturnType<typeof base>) => validateJourneySpec(spec, refs).errors.map((e) => e.code);
    expect(codes(base({ type: 'event', event: 'cart.abandoned' }, [tag, done]))).toEqual([]);
    expect(codes(base({ type: 'manual' }, [tag, done]))).toEqual(['concurrent_trigger']);
    expect(codes(base({ type: 'event', event: 'cart.abandoned' }, [mail, done]))).toEqual(['concurrent_messages']);
  });

  it('keeps call steps person-approved, opening-only and on a voice channel, with outcome edges for calls alone', () => {
    const call = (extra: Record<string, unknown> = {}) =>
      ({ id: 'call', type: 'message', channel: 'voice', content: { body: 'Hei!' }, next: 'done', onOutcome: { reached: 'done' }, ...extra });
    const codes = (node: Record<string, unknown>, voiceChannelId?: string) =>
      validateJourneySpec(
        parseJourneySpec({
          entry: { trigger: { type: 'manual' } },
          goal: { event: 'subscription.started', windowDays: 30 },
          settings: voiceChannelId ? { voiceChannelId } : {},
          start: 'call',
          nodes: [node, { id: 'done', type: 'exit' }],
        }).spec!,
        { ...refs, voiceChannelIds: new Set(['ch_voice']) },
      ).errors.map((e) => e.code);
    expect(codes(call(), 'ch_voice')).toEqual([]);
    expect(codes(call())).toEqual(['voice_channel']);
    expect(codes(call({ approval: 'auto' }), 'ch_voice')).toEqual(['voice_approval']);
    expect(codes(call({ onReply: 'done' }), 'ch_voice')).toEqual(['voice_reply']);
    expect(codes(call({ content: { body: 'x'.repeat(1001) } }), 'ch_voice')).toEqual(['voice_length']);
    expect(
      codes({ id: 'call', type: 'message', channel: 'email', content: { subject: 'Hei', body: 'Hei' }, next: 'done', onOutcome: { reached: 'done' } }),
    ).toEqual(['outcome_edges']);
  });

  it('refuses sub-journeys that would loop back and warns about ones that are not live', () => {
    const spec = parseJourneySpec({
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'sub',
      nodes: [
        { id: 'sub', type: 'sub_journey', journeyId: 'jrn_b', next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    }).spec!;
    const journeys = (bCalls: string[], bStatus = 'live') =>
      new Map([
        ['jrn_a', { status: 'live', calls: ['jrn_b'] }],
        ['jrn_b', { status: bStatus, calls: bCalls }],
        ['jrn_c', { status: 'live', calls: ['jrn_a'] }],
      ]);
    const check = (bCalls: string[], bStatus?: string) =>
      validateJourneySpec(spec, { ...refs, selfJourneyId: 'jrn_a', journeys: journeys(bCalls, bStatus) });
    expect(check([]).errors).toEqual([]);
    expect(check(['jrn_c']).errors.map((e) => e.code)).toEqual(['sub_journey_cycle']);
    expect(check([], 'draft').warnings.map((w) => w.code)).toContain('sub_journey_not_live');
    expect(
      validateJourneySpec(spec, { ...refs, selfJourneyId: 'jrn_a', journeys: new Map() }).errors.map((e) => e.code),
    ).toEqual(['unknown_journey']);
  });

  it('refuses enrich fields that Munin reads itself', () => {
    const spec = parseJourneySpec({
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      start: 'enrich',
      nodes: [
        {
          id: 'enrich',
          type: 'agent',
          mode: 'enrich',
          instructions: 'Work out where they are',
          inputs: ['contact'],
          fields: [{ key: 'timezone', type: 'string', description: 'IANA zone' }],
          next: 'done',
        },
        { id: 'done', type: 'exit' },
      ],
    }).spec!;
    expect(validateJourneySpec(spec, refs).errors.map((e) => e.code)).toEqual(['agent_fields']);
  });
});

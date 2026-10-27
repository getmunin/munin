import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import type { JourneyNode, JourneySpec } from '@getmunin/types';
import { evaluateCondition } from './journey-conditions.ts';
import { stableBucket } from './journey-time.ts';
import { JourneyRuntimeService } from './journey-runtime.service.ts';
import { checkSendPolicy } from '../outreach/send-policy.ts';

const MAX_STEPS = 100;

export interface SimulationInput {
  journeyId: string;
  spec: JourneySpec;
  contactIds?: string[];
  segmentId?: string;
  limit?: number;
  renderSamples?: number;
}

export interface SimulatedMessage {
  nodeId: string;
  contactId: string;
  contactName: string | null;
  channel: 'email' | 'sms' | 'voice' | 'chat';
  subject: string | null;
  body?: string;
  decision: string;
  reason: string | null;
  html?: string;
}

export interface SimulationAssumption {
  code: 'reviewer_approves' | 'no_reply' | 'event_missing' | 'agent_fallback' | 'agent_draft' | 'call_reached' | 'chat_seen' | 'approval_granted' | 'sub_journey_passed';
  nodeId: string;
  event?: string;
  timeout?: string;
}

export interface SimulationResult {
  sample: { source: 'contacts' | 'segment' | 'recent'; segmentId: string | null; size: number };
  entered: number;
  excluded: Record<string, number>;
  arrivals: Record<string, number>;
  edges: Record<string, number>;
  exits: Record<string, number>;
  messages: SimulatedMessage[];
  messageDecisions: Record<string, Record<string, number>>;
  assumptions: SimulationAssumption[];
}

@Injectable()
export class JourneySimulator {
  constructor(@Inject(JourneyRuntimeService) private readonly runtime: JourneyRuntimeService) {}

  async simulate(input: SimulationInput): Promise<SimulationResult> {
    const { spec } = input;
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const sample = await this.pickSample(input, limit);
    const result: SimulationResult = {
      sample: { source: sample.source, segmentId: sample.segmentId, size: sample.contacts.length },
      entered: 0,
      excluded: {},
      arrivals: {},
      edges: {},
      exits: {},
      messages: [],
      messageDecisions: {},
      assumptions: [],
    };
    const assumptions = new Map<string, SimulationAssumption>();
    const now = new Date();
    let rendered = 0;

    for (const contact of sample.contacts) {
      const reason = await this.entryBlock(input.journeyId, spec, contact);
      if (reason) {
        bump(result.excluded, reason);
        continue;
      }
      result.entered += 1;
      const visits: Record<string, number> = {};
      let nodeId: string | undefined = spec.start;
      let exit: string | null = null;
      for (let i = 0; i < MAX_STEPS && nodeId && !exit; i++) {
        const node: JourneyNode | undefined = spec.nodes.find((n) => n.id === nodeId);
        if (!node) {
          exit = 'node_missing';
          break;
        }
        visits[node.id] = (visits[node.id] ?? 0) + 1;
        if (visits[node.id]! > spec.settings.maxVisitsPerNode) {
          exit = 'loop_detected';
          break;
        }
        bump(result.arrivals, node.id);
        const step = await this.step(node, spec, input.journeyId, contact, now, assumptions);
        if (step.message) {
          const decisions = (result.messageDecisions[node.id] ??= {});
          bump(decisions, step.message.decision);
          if (node.type === 'message' && node.channel === 'email' && rendered < (input.renderSamples ?? 3) && step.message.decision !== 'skip') {
            step.message.html = await this.renderSample(node, contact);
            rendered += 1;
          }
          if (result.messages.length < 20) result.messages.push(step.message);
        }
        if (step.exit) {
          exit = step.exit;
          break;
        }
        bump(result.edges, `${node.id}.${step.edge}`);
        nodeId = step.to;
      }
      bump(result.exits, exit ?? 'reached_end');
    }
    result.assumptions = [...assumptions.values()];
    return result;
  }

  private async step(
    node: JourneyNode,
    spec: JourneySpec,
    journeyId: string,
    contact: SampleContact,
    now: Date,
    assumptions: Map<string, SimulationAssumption>,
  ): Promise<{ edge?: string; to?: string; exit?: string; message?: SimulatedMessage }> {
    switch (node.type) {
      case 'message': {
        if (node.approval === 'off') return { edge: 'next', to: node.next };
        if (contact.kind === 'company') return this.companyStep(node, spec, contact, now, assumptions);
        const settings = spec.settings;
        const decision = await checkSendPolicy({
          contactId: contact.id,
          now,
          policy: {
            channel: node.channel,
            class: node.class,
            timezone: settings.timezone,
            quietHours: settings.quietHours,
            validDays: settings.validDays,
            frequencyCapPerWeek: settings.frequencyCapPerWeek,
            cooldownHoursAfterConversation: settings.cooldownHoursAfterConversation,
          },
        });
        const message: SimulatedMessage = {
          nodeId: node.id,
          contactId: contact.id,
          contactName: contact.name,
          channel: node.channel,
          subject: node.content.subject ?? null,
          ...(node.channel === 'sms' || node.channel === 'chat' ? { body: node.content.body } : {}),
          decision: decision.decision,
          reason: decision.decision === 'send' ? null : decision.reason,
        };
        if (node.approval === 'draft_only') {
          assumptions.set(`approve:${node.id}`, { code: 'reviewer_approves', nodeId: node.id });
        }
        if (node.draftBy === 'agent') {
          assumptions.set(`draft:${node.id}`, { code: 'agent_draft', nodeId: node.id });
        }
        if (decision.decision === 'skip') return { exit: 'message_blocked', message };
        if (node.channel === 'voice') {
          assumptions.set(`call:${node.id}`, { code: 'call_reached', nodeId: node.id });
          const reached = node.onOutcome?.reached;
          return reached ? { edge: 'outcome_reached', to: reached, message } : { edge: 'next', to: node.next, message };
        }
        if (node.channel === 'chat') assumptions.set(`seen:${node.id}`, { code: 'chat_seen', nodeId: node.id });
        if (node.onReply) assumptions.set(`reply:${node.id}`, { code: 'no_reply', nodeId: node.id });
        return { edge: 'next', to: node.next, message };
      }
      case 'wait':
        return { edge: 'next', to: node.next };
      case 'wait_for':
        assumptions.set(`event:${node.id}`, {
          code: 'event_missing',
          nodeId: node.id,
          event: node.event,
          timeout: node.timeout,
        });
        return node.onTimeout ? { edge: 'on_timeout', to: node.onTimeout } : { exit: 'wait_timeout' };
      case 'branch': {
        const facts = await this.runtime.conditionFacts(
          contact.kind === 'company'
            ? { contactId: null, endUserId: null, companyId: contact.id, context: {}, enteredAt: now, now, spec }
            : { contactId: contact.id, endUserId: contact.endUserId, context: {}, enteredAt: now, now, spec },
          node.rules.map((r) => r.if),
        );
        const index = node.rules.findIndex((rule) => evaluateCondition(rule.if, facts));
        if (index >= 0) return { edge: `rule_${index + 1}`, to: node.rules[index]!.next };
        return { edge: 'default', to: node.default };
      }
      case 'split': {
        const bucket = stableBucket(sampleKey(contact), journeyId, node.id);
        let cumulative = 0;
        for (const path of node.paths) {
          cumulative += path.percent;
          if (bucket < cumulative) return { edge: path.name, to: path.next };
        }
        const last = node.paths[node.paths.length - 1]!;
        return { edge: last.name, to: last.next };
      }
      case 'goal':
        return node.exitOnReach ? { exit: 'goal_reached' } : { edge: 'next', to: node.next };
      case 'jump':
        return { edge: 'jump', to: node.to };
      case 'exit':
        return { exit: node.reason };
      case 'action':
        return { edge: 'next', to: node.next };
      case 'agent':
        if (node.mode === 'enrich') {
          assumptions.set(`agent:${node.id}`, { code: 'agent_fallback', nodeId: node.id, event: 'next' });
          return { edge: 'next', to: node.next };
        }
        assumptions.set(`agent:${node.id}`, { code: 'agent_fallback', nodeId: node.id, event: node.fallback });
        return { edge: node.fallback!, to: node.edges?.[node.fallback!] };
      case 'approval':
        assumptions.set(`approval:${node.id}`, { code: 'approval_granted', nodeId: node.id });
        return { edge: 'next', to: node.next };
      case 'sub_journey':
        assumptions.set(`sub:${node.id}`, { code: 'sub_journey_passed', nodeId: node.id, event: node.journeyId });
        return { edge: 'next', to: node.next };
      default:
        return { exit: 'node_type_unavailable' };
    }
  }

  private async companyStep(
    node: Extract<JourneyNode, { type: 'message' }>,
    spec: JourneySpec,
    company: SampleContact,
    now: Date,
    assumptions: Map<string, SimulationAssumption>,
  ): Promise<{ edge?: string; to?: string; exit?: string; message?: SimulatedMessage }> {
    const recipients = await this.runtime.companyRecipients(company.id, node.recipients);
    if (recipients.length === 0) return { exit: 'no_recipients' };
    const settings = spec.settings;
    let reached = false;
    let first: SimulatedMessage | undefined;
    for (const contactId of recipients) {
      const decision = await checkSendPolicy({
        contactId,
        now,
        policy: {
          channel: node.channel,
          class: node.class,
          timezone: settings.timezone,
          quietHours: settings.quietHours,
          validDays: settings.validDays,
          frequencyCapPerWeek: settings.frequencyCapPerWeek,
          cooldownHoursAfterConversation: settings.cooldownHoursAfterConversation,
        },
      });
      if (decision.decision !== 'skip') reached = true;
      first ??= {
        nodeId: node.id,
        contactId,
        contactName: company.name,
        channel: node.channel,
        subject: node.content.subject ?? null,
        ...(node.channel === 'sms' || node.channel === 'chat' ? { body: node.content.body } : {}),
        decision: decision.decision,
        reason: decision.decision === 'send' ? null : decision.reason,
      };
    }
    if (node.approval === 'draft_only') assumptions.set(`approve:${node.id}`, { code: 'reviewer_approves', nodeId: node.id });
    if (!reached) return { exit: 'message_blocked', message: first };
    return { edge: 'next', to: node.next, message: first };
  }

  private async entryBlock(journeyId: string, spec: JourneySpec, contact: SampleContact): Promise<string | null> {
    const member = (segmentId: string) =>
      contact.kind === 'company'
        ? this.runtime.companyInSegment(contact.id, segmentId)
        : this.runtime.contactInSegment(contact.id, segmentId);
    if (spec.entry.segmentId && !(await member(spec.entry.segmentId))) return 'not_in_segment';
    if (spec.entry.trigger.type === 'segment' && !(await member(spec.entry.trigger.segmentId))) return 'not_in_segment';
    if (stableBucket(sampleKey(contact), journeyId) < spec.settings.holdoutPct) return 'holdout';
    return null;
  }

  private async pickSample(
    input: SimulationInput,
    limit: number,
  ): Promise<{ source: SimulationResult['sample']['source']; segmentId: string | null; contacts: SampleContact[] }> {
    const ctx = getCurrentContext();
    if (input.spec.entry.subject === 'company') return this.pickCompanies(input, limit);
    const c = schema.crmContacts;
    const columns = { id: c.id, name: c.name, endUserId: c.endUserId };
    if (input.contactIds?.length) {
      const rows = await ctx.db
        .select(columns)
        .from(c)
        .where(and(eq(c.orgId, ctx.actor!.orgId), inArray(c.id, input.contactIds.slice(0, limit))));
      return { source: 'contacts', segmentId: null, contacts: rows };
    }
    const trigger = input.spec.entry.trigger;
    const segmentId =
      input.segmentId ?? input.spec.entry.segmentId ?? (trigger.type === 'segment' ? trigger.segmentId : null);
    if (segmentId) {
      const ids = await this.runtime.segmentContacts(segmentId, limit);
      const rows = ids.length
        ? await ctx.db.select(columns).from(c).where(inArray(c.id, ids))
        : [];
      return { source: 'segment', segmentId, contacts: rows };
    }
    const rows = await ctx.db
      .select(columns)
      .from(c)
      .where(eq(c.orgId, ctx.actor!.orgId))
      .orderBy(desc(c.updatedAt))
      .limit(limit);
    return { source: 'recent', segmentId: null, contacts: rows };
  }

  private async pickCompanies(
    input: SimulationInput,
    limit: number,
  ): Promise<{ source: SimulationResult['sample']['source']; segmentId: string | null; contacts: SampleContact[] }> {
    const ctx = getCurrentContext();
    const co = schema.crmCompanies;
    const load = async (ids: string[]) =>
      ids.length
        ? (await ctx.db.select({ id: co.id, name: co.name }).from(co).where(inArray(co.id, ids))).map(
            (r): SampleContact => ({ id: r.id, name: r.name, endUserId: null, kind: 'company' }),
          )
        : [];
    if (input.contactIds?.length) {
      const rows = await ctx.db
        .selectDistinct({ companyId: schema.crmContacts.companyId })
        .from(schema.crmContacts)
        .where(and(eq(schema.crmContacts.orgId, ctx.actor!.orgId), inArray(schema.crmContacts.id, input.contactIds.slice(0, limit))));
      return { source: 'contacts', segmentId: null, contacts: await load(rows.map((r) => r.companyId).filter((id): id is string => !!id)) };
    }
    const trigger = input.spec.entry.trigger;
    const segmentId =
      input.segmentId ?? input.spec.entry.segmentId ?? (trigger.type === 'segment' ? trigger.segmentId : null);
    if (segmentId) {
      return { source: 'segment', segmentId, contacts: await load(await this.runtime.segmentCompanies(segmentId, limit)) };
    }
    const recent = await ctx.db
      .select({ id: co.id })
      .from(co)
      .where(eq(co.orgId, ctx.actor!.orgId))
      .orderBy(desc(co.updatedAt))
      .limit(limit);
    return { source: 'recent', segmentId: null, contacts: await load(recent.map((r) => r.id)) };
  }

  private async renderSample(node: Extract<JourneyNode, { type: 'message' }>, contact: SampleContact): Promise<string> {
    const ctx = getCurrentContext();
    const { renderEmail, BUILT_IN_EMAIL_TEMPLATE } = await import('../outreach/email-template-render.ts');
    const t = schema.outreachEmailTemplates;
    const [template] = await ctx.db
      .select({ mjml: t.mjml })
      .from(t)
      .where(node.content.templateId ? eq(t.id, node.content.templateId) : and(eq(t.orgId, ctx.actor!.orgId), eq(t.isDefault, true)))
      .limit(1);
    const [org] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, ctx.actor!.orgId))
      .limit(1);
    const rendered = await renderEmail(
      template?.mjml ?? BUILT_IN_EMAIL_TEMPLATE,
      { format: node.content.format, body: node.content.body },
      {
        subject: node.content.subject ?? '',
        preheader: node.content.preheader ?? null,
        name: contact.name,
        orgName: org?.name ?? null,
        unsubscribeUrl: node.class === 'marketing' ? 'https://example.invalid/unsubscribe' : null,
      },
    );
    return rendered.html;
  }
}

interface SampleContact {
  id: string;
  name: string | null;
  endUserId: string | null;
  kind?: 'company';
}

function sampleKey(subject: SampleContact): string {
  return subject.kind === 'company' ? `co:${subject.id}` : `c:${subject.id}`;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

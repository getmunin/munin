import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, readApiBaseUrl, WebhookDispatcher } from '@getmunin/core';
import {
  JourneySpecSchema,
  parseIsoDurationMs,
  type JourneyNode,
  type JourneySpec,
} from '@getmunin/types';
import { CrmService } from '../crm/crm.service.ts';
import { OutreachService } from '../outreach/outreach.service.ts';
import { OUTREACH_ELIGIBILITY_FLOOR, segmentMatchFilters } from '../crm/segment-filter.ts';
import { collectConditionNeeds, evaluateCondition, type ConditionFacts } from './journey-conditions.ts';
import { JOURNEY_RUNTIME_ACTOR_ID, journeyEventKey } from './journey-event.sink.ts';
import { MAX_ACTION_ATTEMPTS, nextValidTime, retryDelayMs, stableBucket } from './journey-time.ts';

export const ENROLLMENT_STATES = ['active', 'waiting', 'done', 'exited'] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

const MAX_NODES_PER_RUN = 50;
const COMPLETED_REASONS: ReadonlySet<string> = new Set(['reached_end', 'goal_reached']);
const APPROVAL_TIMEOUT_MS = 7 * 86_400_000;
const REPLY_HOLD_MS = 14 * 86_400_000;
const PROPOSAL_RESOLUTIONS: Record<string, string> = {
  'outreach.proposal.sent': 'proposal_sent',
  'outreach.proposal.dismissed': 'proposal_dismissed',
  'outreach.proposal.withdrawn': 'proposal_withdrawn',
  'outreach.proposal.send_failed': 'proposal_failed',
};

type EnrollmentRow = typeof schema.journeyEnrollments.$inferSelect;
type InboxRow = typeof schema.journeyEventInbox.$inferSelect;
type WaitRow = typeof schema.journeyWaits.$inferSelect;

export interface Subject {
  contactId: string | null;
  endUserId: string | null;
}

export interface EnrollResult {
  status: 'enrolled' | 'skipped';
  reason?: string;
  enrollmentId?: string;
}

export interface EnrollmentDto {
  id: string;
  journeyId: string;
  version: number;
  contactId: string | null;
  endUserId: string | null;
  state: EnrollmentState;
  currentNode: string | null;
  holdout: boolean;
  enteredAt: string;
  nextRunAt: string | null;
  goalReachedAt: string | null;
  exitedAt: string | null;
  exitReason: string | null;
}

export interface StepRunDto {
  nodeId: string;
  nodeType: string;
  visit: number;
  attempt: number;
  status: string;
  edgeTaken: string | null;
  reason: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  proposalId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TraceDto {
  enrollment: EnrollmentDto;
  context: Record<string, unknown>;
  steps: StepRunDto[];
  openWaits: { kind: string; wakeAt: string | null; eventKey: string | null; timeoutAt: string | null }[];
}

type Outcome =
  | { kind: 'advance'; edge: string; to: string | undefined; output?: Record<string, unknown>; reason?: string }
  | { kind: 'wait'; wait: WaitSpec; output?: Record<string, unknown>; reason?: string }
  | { kind: 'exit'; reason: string; output?: Record<string, unknown> }
  | { kind: 'retry'; at: Date; reason: string };

interface WaitSpec {
  kind: 'timer' | 'event' | 'proposal' | 'conversation_close';
  wakeAt?: Date;
  eventKey?: string;
  match?: Record<string, unknown>;
  timeoutAt?: Date;
}

interface StepContext {
  stepRunId: string;
  enrollment: EnrollmentRow;
  spec: JourneySpec;
  node: JourneyNode;
  visit: number;
  attempt: number;
  resumed: WaitRow | null;
  now: Date;
  hop: number;
}

@Injectable()
export class JourneyRuntimeService {
  private readonly specCache = new Map<string, JourneySpec>();

  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(OutreachService) private readonly outreach: OutreachService,
  ) {}


  async enroll(input: {
    journeyId: string;
    subject: Subject;
    source: Record<string, unknown>;
    context?: Record<string, unknown>;
    occurredAt?: Date;
    hop?: number;
  }): Promise<EnrollResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [journey] = await ctx.db
      .select()
      .from(schema.journeys)
      .where(and(eq(schema.journeys.orgId, orgId), eq(schema.journeys.id, input.journeyId)))
      .limit(1);
    if (!journey) throw new NotFoundException(`journeys_not_found: journey ${input.journeyId}`);
    if (journey.status !== 'live' || !journey.liveVersion) {
      return { status: 'skipped', reason: 'journey_not_live' };
    }
    const spec = await this.spec(journey.id, journey.liveVersion);
    const now = new Date();
    if (spec.entry.lastEntryAt && new Date(spec.entry.lastEntryAt) < now) {
      return { status: 'skipped', reason: 'entry_closed' };
    }

    const subject = await this.completeSubject(input.subject);
    const subjectKey = subjectKeyOf(subject);
    if (!subjectKey) return { status: 'skipped', reason: 'no_subject' };

    if (spec.entry.segmentId) {
      if (!subject.contactId) return { status: 'skipped', reason: 'not_in_segment' };
      const inSegment = await this.contactInSegment(subject.contactId, spec.entry.segmentId);
      if (!inSegment) return { status: 'skipped', reason: 'not_in_segment' };
    }

    const e = schema.journeyEnrollments;
    const prior = await ctx.db
      .select({ id: e.id, state: e.state })
      .from(e)
      .where(and(eq(e.journeyId, journey.id), eq(e.subjectKey, subjectKey)))
      .limit(1);
    if (spec.entry.reentry === 'once' && prior.length > 0) {
      return { status: 'skipped', reason: 'already_enrolled' };
    }
    const [open] = await ctx.db
      .select({ id: e.id })
      .from(e)
      .where(and(eq(e.journeyId, journey.id), eq(e.subjectKey, subjectKey), inArray(e.state, ['active', 'waiting'])))
      .limit(1);
    if (open) return { status: 'skipped', reason: 'already_active', enrollmentId: open.id };

    const holdout = stableBucket(subjectKey, journey.id) < spec.settings.holdoutPct;
    const idleDeadlineAt = spec.exit.idleDays ? new Date(now.getTime() + spec.exit.idleDays * 86_400_000) : null;
    const [row] = await ctx.db
      .insert(e)
      .values({
        orgId,
        journeyId: journey.id,
        version: journey.liveVersion,
        contactId: subject.contactId,
        endUserId: subject.endUserId,
        subjectKey,
        state: holdout ? 'done' : 'active',
        currentNode: holdout ? null : spec.start,
        visits: holdout ? {} : { [spec.start]: 1 },
        context: input.context ?? {},
        holdout,
        source: input.source,
        enteredAt: input.occurredAt && input.occurredAt < now ? input.occurredAt : now,
        nextRunAt: holdout ? null : now,
        idleDeadlineAt,
        exitedAt: holdout ? now : null,
        exitReason: holdout ? 'holdout' : null,
      })
      .onConflictDoNothing()
      .returning({ id: e.id });
    if (!row) return { status: 'skipped', reason: 'already_active' };

    await this.webhooks.emit({
      type: 'journey.enrolled',
      payload: {
        journeyId: journey.id,
        enrollmentId: row.id,
        version: journey.liveVersion,
        contactId: subject.contactId,
        endUserId: subject.endUserId,
        holdout,
        source: input.source,
      },
      hopCount: input.hop ?? 0,
    });
    return { status: 'enrolled', enrollmentId: row.id };
  }

  async runScheduledEntries(now = new Date(), limit = 500): Promise<number> {
    const ctx = getCurrentContext();
    const j = schema.journeys;
    const due = await ctx.db
      .select()
      .from(j)
      .where(and(eq(j.orgId, ctx.actor!.orgId), eq(j.status, 'live'), lte(j.nextEntryAt, now)));
    let enrolled = 0;
    for (const journey of due) {
      const spec = await this.spec(journey.id, journey.liveVersion!);
      const trigger = spec.entry.trigger;
      if (trigger.type !== 'segment') {
        await ctx.db.update(j).set({ nextEntryAt: null }).where(eq(j.id, journey.id));
        continue;
      }
      const contacts = await this.segmentContacts(trigger.segmentId, limit);
      for (const contactId of contacts) {
        const result = await this.enroll({
          journeyId: journey.id,
          subject: { contactId, endUserId: null },
          source: { type: 'segment', segmentId: trigger.segmentId },
        });
        if (result.status === 'enrolled') enrolled += 1;
      }
      await ctx.db
        .update(j)
        .set({ nextEntryAt: nextScheduledEntry(trigger, now), updatedAt: new Date() })
        .where(eq(j.id, journey.id));
    }
    return enrolled;
  }


  async processInboxRow(row: InboxRow): Promise<void> {
    const ctx = getCurrentContext();
    const payload = row.payload;
    const key = journeyEventKey(row.type, payload);
    const occurredAt = parseDate(payload.occurredAt) ?? row.createdAt;
    const subject = await this.completeSubject(await this.subjectFromPayload(payload));
    const hop = row.hopCount + 1;

    if (row.actorId !== JOURNEY_RUNTIME_ACTOR_ID && (subject.contactId || subject.endUserId)) {
      for (const journey of await this.liveJourneys()) {
        const spec = await this.spec(journey.id, journey.liveVersion!);
        const trigger = spec.entry.trigger;
        if (trigger.type !== 'event' || trigger.event !== key) continue;
        if (!payloadMatches(payload, trigger.where)) continue;
        const ageMs = Date.now() - occurredAt.getTime();
        if (ageMs > spec.entry.lateEventWindowHours * 3_600_000) continue;
        await this.enroll({
          journeyId: journey.id,
          subject,
          source: { type: 'event', event: key, eventId: row.eventId },
          context: { trigger: payload },
          occurredAt,
          hop,
        });
      }
    }

    if (row.type.startsWith('outreach.proposal.')) await this.handleProposalEvent(row);

    const enrollments = await this.subjectEnrollments(subject, payload);
    if (enrollments.length === 0) return;
    if (row.type === 'conversation.message.received') await this.handleReply(row, enrollments);

    const w = schema.journeyWaits;
    const openWaits = await ctx.db
      .select()
      .from(w)
      .where(
        and(
          isNull(w.resolvedAt),
          eq(w.eventKey, key),
          inArray(w.enrollmentId, enrollments.map((e) => e.id)),
        ),
      );
    for (const wait of openWaits) {
      if (!payloadMatches(payload, wait.match as Record<string, string | number | boolean>)) continue;
      await this.resolveWait(wait, 'event', { lastEvent: { type: key, payload, eventId: row.eventId } });
    }

    for (const enrollment of enrollments) {
      const spec = await this.spec(enrollment.journeyId, enrollment.version);
      if (spec.goal && !enrollment.goalReachedAt && spec.goal.event === key && payloadMatches(payload, spec.goal.where)) {
        const windowEnd = enrollment.enteredAt.getTime() + spec.goal.windowDays * 86_400_000;
        if (occurredAt.getTime() <= windowEnd) {
          await this.markGoal(enrollment, 'goal_event', hop);
          if (spec.goal.exitOnGoal && isOpen(enrollment.state)) {
            await this.finish(enrollment, 'goal_reached', hop);
            continue;
          }
        }
      }
      if (isOpen(enrollment.state) && spec.exit.on.some((rule) => rule.event === key && payloadMatches(payload, rule.where))) {
        await this.finish(enrollment, 'matched_exit', hop);
      }
    }
  }


  async resolveDueWaits(now = new Date()): Promise<number> {
    const ctx = getCurrentContext();
    const w = schema.journeyWaits;
    const due = await ctx.db
      .select()
      .from(w)
      .where(
        and(
          eq(w.orgId, ctx.actor!.orgId),
          isNull(w.resolvedAt),
          or(lte(w.wakeAt, now), lte(w.timeoutAt, now)),
        ),
      )
      .orderBy(asc(w.createdAt))
      .limit(500);
    for (const wait of due) {
      const timedOut = !(wait.wakeAt && wait.wakeAt <= now);
      await this.resolveWait(wait, timedOut ? 'timeout' : 'timer');
    }

    const e = schema.journeyEnrollments;
    const idle = await ctx.db
      .select()
      .from(e)
      .where(
        and(
          eq(e.orgId, ctx.actor!.orgId),
          inArray(e.state, ['active', 'waiting']),
          lte(e.idleDeadlineAt, now),
        ),
      )
      .limit(500);
    for (const enrollment of idle) await this.finish(enrollment, 'idle_timeout', 1);
    return due.length + idle.length;
  }


  async runEnrollment(enrollmentId: string, now = new Date()): Promise<void> {
    const ctx = getCurrentContext();
    const e = schema.journeyEnrollments;
    const locked = await ctx.db.execute(
      sql`SELECT id FROM journey_enrollments WHERE id = ${enrollmentId} AND state = 'active' FOR UPDATE SKIP LOCKED`,
    );
    if (rowsOf(locked).length === 0) return;

    for (let i = 0; i < MAX_NODES_PER_RUN; i++) {
      const [enrollment] = await ctx.db.select().from(e).where(eq(e.id, enrollmentId)).limit(1);
      if (!enrollment || enrollment.state !== 'active' || !enrollment.currentNode) return;
      const [journey] = await ctx.db
        .select({ status: schema.journeys.status })
        .from(schema.journeys)
        .where(eq(schema.journeys.id, enrollment.journeyId))
        .limit(1);
      if (journey?.status !== 'live') return;

      const spec = await this.spec(enrollment.journeyId, enrollment.version);
      const node = spec.nodes.find((n) => n.id === enrollment.currentNode);
      if (!node) {
        await this.finish(enrollment, 'node_missing', 1);
        return;
      }
      const visit = enrollment.visits[node.id] ?? 1;
      if (visit > spec.settings.maxVisitsPerNode) {
        await this.finish(enrollment, 'loop_detected', 1);
        return;
      }

      const sr = schema.journeyStepRuns;
      const [existing] = await ctx.db
        .select()
        .from(sr)
        .where(and(eq(sr.enrollmentId, enrollment.id), eq(sr.nodeId, node.id), eq(sr.visit, visit)))
        .limit(1);

      let outcome: Outcome;
      let stepRunId: string;
      if (existing?.status === 'completed') {
        outcome = existing.edgeTaken
          ? { kind: 'advance', edge: existing.edgeTaken, to: edgeTarget(node, existing.edgeTaken) }
          : { kind: 'exit', reason: existing.reason ?? 'reached_end' };
        stepRunId = existing.id;
      } else {
        const resumed = existing?.status === 'waiting' ? await this.latestWait(existing.id) : null;
        const attempt = existing?.status === 'retrying' ? existing.attempt + 1 : 1;
        stepRunId =
          existing?.id ??
          (await this.insertStepRun(enrollment, node, visit, { enteredAt: now.toISOString() }));
        outcome = await this.execute({ stepRunId, enrollment, spec, node, visit, attempt, resumed, now, hop: 1 });
        if (outcome.kind === 'retry') {
          await this.updateStepRun(stepRunId, { status: 'retrying', attempt, reason: outcome.reason });
          await ctx.db.update(e).set({ nextRunAt: outcome.at, updatedAt: new Date() }).where(eq(e.id, enrollment.id));
          return;
        }
        if (outcome.kind === 'wait') {
          await this.updateStepRun(stepRunId, {
            status: 'waiting',
            attempt,
            output: outcome.output,
            reason: outcome.reason,
          });
          await this.openWait(enrollment, stepRunId, outcome.wait);
          return;
        }
        await this.updateStepRun(stepRunId, {
          status: 'completed',
          attempt,
          output: outcome.output,
          edgeTaken: outcome.kind === 'advance' ? outcome.edge : null,
          reason: outcome.kind === 'exit' ? outcome.reason : (outcome.reason ?? null),
          finished: true,
        });
      }

      if (outcome.kind === 'exit') {
        await this.finish(enrollment, outcome.reason, 1);
        return;
      }
      if (outcome.kind !== 'advance') return;
      if (!outcome.to) {
        await this.finish(enrollment, 'reached_end', 1);
        return;
      }
      const visits = { ...enrollment.visits, [outcome.to]: (enrollment.visits[outcome.to] ?? 0) + 1 };
      await ctx.db
        .update(e)
        .set({ currentNode: outcome.to, visits, nextRunAt: now, updatedAt: new Date() })
        .where(eq(e.id, enrollment.id));
    }
  }

  private async execute(step: StepContext): Promise<Outcome> {
    const { node } = step;
    switch (node.type) {
      case 'wait':
        return this.executeWait(step, node);
      case 'wait_for': {
        if (step.resumed) {
          if (step.resumed.resolution === 'event') return { kind: 'advance', edge: 'next', to: node.next };
          if (node.onTimeout) return { kind: 'advance', edge: 'on_timeout', to: node.onTimeout };
          return { kind: 'exit', reason: 'wait_timeout' };
        }
        const timeoutMs = parseIsoDurationMs(node.timeout) ?? 0;
        return {
          kind: 'wait',
          wait: {
            kind: 'event',
            eventKey: node.event,
            match: node.where ?? {},
            timeoutAt: new Date(step.now.getTime() + timeoutMs),
          },
          reason: `waiting for ${node.event}`,
        };
      }
      case 'branch': {
        const facts = await this.loadFacts(step, node.rules.map((r) => r.if));
        const index = node.rules.findIndex((rule) => evaluateCondition(rule.if, facts));
        if (index >= 0) {
          return { kind: 'advance', edge: `rule_${index + 1}`, to: node.rules[index]!.next, reason: `rule ${index + 1} matched` };
        }
        return { kind: 'advance', edge: 'default', to: node.default, reason: 'no rule matched' };
      }
      case 'split': {
        const bucket = stableBucket(step.enrollment.subjectKey, step.enrollment.journeyId, node.id);
        let cumulative = 0;
        for (const path of node.paths) {
          cumulative += path.percent;
          if (bucket < cumulative) {
            return { kind: 'advance', edge: path.name, to: path.next, output: { bucket } };
          }
        }
        const last = node.paths[node.paths.length - 1]!;
        return { kind: 'advance', edge: last.name, to: last.next, output: { bucket } };
      }
      case 'goal':
        await this.markGoal(step.enrollment, node.name, step.hop);
        if (node.exitOnReach) return { kind: 'exit', reason: 'goal_reached' };
        return { kind: 'advance', edge: 'next', to: node.next };
      case 'jump':
        return { kind: 'advance', edge: 'jump', to: node.to };
      case 'exit':
        return { kind: 'exit', reason: node.reason };
      case 'action':
        return this.executeAction(step, node);
      case 'message':
        return this.executeMessage(step, node);
      default:
        return { kind: 'exit', reason: 'node_type_unavailable' };
    }
  }

  private async executeMessage(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'message' }>,
  ): Promise<Outcome> {
    if (step.resumed) {
      switch (step.resumed.resolution) {
        case 'proposal_sent':
        case 'proposal_withdrawn':
          return { kind: 'advance', edge: 'next', to: node.next, reason: step.resumed.resolution };
        case 'proposal_dismissed':
          return { kind: 'exit', reason: 'proposal_dismissed' };
        case 'proposal_failed':
          return { kind: 'exit', reason: 'message_failed' };
        default:
          return { kind: 'exit', reason: 'approval_timeout' };
      }
    }
    if (node.approval === 'off') return { kind: 'advance', edge: 'next', to: node.next, reason: 'approval off' };
    const contactId = step.enrollment.contactId;
    if (!contactId) return { kind: 'exit', reason: 'no_contact' };
    const ctx = getCurrentContext();
    const [journey] = await ctx.db
      .select({ campaignId: schema.journeys.outreachCampaignId })
      .from(schema.journeys)
      .where(eq(schema.journeys.id, step.enrollment.journeyId))
      .limit(1);
    const settings = step.spec.settings;
    const proposal = await this.outreach.proposeJourneyMessage(
      {
        campaignId: journey!.campaignId,
        contactId,
        enrollmentId: step.enrollment.id,
        stepRunId: step.stepRunId,
        subject: node.content.subject,
        body: node.content.body,
        format: node.content.format,
        templateId: node.content.templateId,
        preheader: node.content.preheader,
        auto: node.approval === 'auto',
        policy: {
          class: node.class,
          timezone: settings.timezone,
          quietHours: settings.quietHours,
          validDays: settings.validDays,
          frequencyCapPerWeek: settings.frequencyCapPerWeek,
          cooldownHoursAfterConversation: settings.cooldownHoursAfterConversation,
        },
        evidence: {
          journeyId: step.enrollment.journeyId,
          version: step.enrollment.version,
          nodeId: node.id,
        },
      },
      { publicBaseUrl: readApiBaseUrl() },
    );
    await ctx.db
      .update(schema.journeyStepRuns)
      .set({ proposalId: proposal.id })
      .where(eq(schema.journeyStepRuns.id, step.stepRunId));
    if (proposal.status === 'sent') {
      await this.rememberThread(step.enrollment.id, proposal.conversationId);
      return { kind: 'advance', edge: 'next', to: node.next, output: { proposalId: proposal.id }, reason: 'sent' };
    }
    if (proposal.status === 'failed') {
      return { kind: 'exit', reason: 'message_blocked', output: { proposalId: proposal.id, error: proposal.failureReason } };
    }
    const base = proposal.scheduledSendAt ? new Date(proposal.scheduledSendAt) : step.now;
    return {
      kind: 'wait',
      wait: {
        kind: 'proposal',
        match: { proposalId: proposal.id },
        timeoutAt: new Date(base.getTime() + APPROVAL_TIMEOUT_MS),
      },
      output: { proposalId: proposal.id, status: proposal.status },
      reason: proposal.status === 'approved' ? 'scheduled' : 'awaiting review',
    };
  }

  private async rememberThread(enrollmentId: string, conversationId: string | null): Promise<void> {
    if (!conversationId) return;
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.journeyEnrollments)
      .set({ conversationId, updatedAt: new Date() })
      .where(and(eq(schema.journeyEnrollments.id, enrollmentId), isNull(schema.journeyEnrollments.conversationId)));
  }

  private async handleProposalEvent(row: InboxRow): Promise<void> {
    const resolution = PROPOSAL_RESOLUTIONS[row.type];
    const proposalId = row.payload.proposalId;
    if (!resolution || typeof proposalId !== 'string') return;
    const ctx = getCurrentContext();
    const w = schema.journeyWaits;
    const [wait] = await ctx.db
      .select()
      .from(w)
      .where(and(eq(w.orgId, row.orgId), eq(w.kind, 'proposal'), isNull(w.resolvedAt), sql`${w.match}->>'proposalId' = ${proposalId}`))
      .limit(1);
    if (!wait) return;
    if (resolution === 'proposal_sent' && typeof row.payload.conversationId === 'string') {
      await this.rememberThread(wait.enrollmentId, row.payload.conversationId);
    }
    await this.resolveWait(wait, resolution);
  }

  private async handleReply(row: InboxRow, enrollments: EnrollmentRow[]): Promise<void> {
    const conversationId = row.payload.conversationId;
    if (typeof conversationId !== 'string' || row.payload.authorType !== 'end_user') return;
    if (row.payload.autoReply === true) return;
    const ctx = getCurrentContext();
    for (const enrollment of enrollments) {
      if (enrollment.conversationId !== conversationId || !isOpen(enrollment.state)) continue;
      const spec = await this.spec(enrollment.journeyId, enrollment.version);
      const [lastMessage] = await ctx.db
        .select({ nodeId: schema.journeyStepRuns.nodeId, id: schema.journeyStepRuns.id })
        .from(schema.journeyStepRuns)
        .where(and(eq(schema.journeyStepRuns.enrollmentId, enrollment.id), eq(schema.journeyStepRuns.nodeType, 'message')))
        .orderBy(desc(schema.journeyStepRuns.startedAt))
        .limit(1);
      if (!lastMessage) continue;
      const node = spec.nodes.find((n) => n.id === lastMessage.nodeId);
      const reply = { conversationId, messageId: row.payload.messageId ?? null, eventId: row.eventId };
      if (node?.type === 'message' && node.onReply) {
        await this.cancelWaits(enrollment.id);
        const visits = { ...enrollment.visits, [node.onReply]: (enrollment.visits[node.onReply] ?? 0) + 1 };
        await ctx.db
          .update(schema.journeyEnrollments)
          .set({
            state: 'active',
            currentNode: node.onReply,
            visits,
            nextRunAt: new Date(),
            context: { ...enrollment.context, lastReply: reply },
            updatedAt: new Date(),
          })
          .where(eq(schema.journeyEnrollments.id, enrollment.id));
        continue;
      }
      const [held] = await ctx.db
        .select({ id: schema.journeyWaits.id })
        .from(schema.journeyWaits)
        .where(
          and(
            eq(schema.journeyWaits.enrollmentId, enrollment.id),
            eq(schema.journeyWaits.kind, 'conversation_close'),
            isNull(schema.journeyWaits.resolvedAt),
          ),
        )
        .limit(1);
      if (held) continue;
      await ctx.db.insert(schema.journeyWaits).values({
        orgId: enrollment.orgId,
        enrollmentId: enrollment.id,
        stepRunId: lastMessage.id,
        kind: 'conversation_close',
        eventKey: 'conversation.status_changed',
        match: { conversationId, status: 'closed' },
        timeoutAt: new Date(Date.now() + REPLY_HOLD_MS),
      });
      await ctx.db
        .update(schema.journeyEnrollments)
        .set({
          state: 'waiting',
          nextRunAt: null,
          context: { ...enrollment.context, lastReply: reply },
          updatedAt: new Date(),
        })
        .where(eq(schema.journeyEnrollments.id, enrollment.id));
    }
  }

  private async cancelWaits(enrollmentId: string): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.journeyWaits)
      .set({ resolvedAt: new Date(), resolution: 'cancelled' })
      .where(and(eq(schema.journeyWaits.enrollmentId, enrollmentId), isNull(schema.journeyWaits.resolvedAt)));
  }

  private async executeWait(step: StepContext, node: Extract<JourneyNode, { type: 'wait' }>): Promise<Outcome> {
    if (step.resumed) return { kind: 'advance', edge: 'next', to: node.next };
    const timezone = await this.timezoneFor(step);
    let wakeAt: Date | null = null;
    if (node.duration) wakeAt = new Date(step.now.getTime() + (parseIsoDurationMs(node.duration) ?? 0));
    else if (node.until) wakeAt = new Date(node.until);
    else if (node.untilField) {
      const base = await this.readDateField(step, node.untilField.field);
      if (!base) return { kind: 'advance', edge: 'next', to: node.next, reason: `${node.untilField.field} is empty` };
      const offset = node.untilField.offset ?? 'P0D';
      const negative = offset.startsWith('-');
      const ms = parseIsoDurationMs(negative ? offset.slice(1) : offset) ?? 0;
      wakeAt = new Date(base.getTime() + (negative ? -ms : ms));
    }
    wakeAt = nextValidTime(wakeAt ?? step.now, timezone, node.validDays, node.validHours);
    if (wakeAt <= step.now) return { kind: 'advance', edge: 'next', to: node.next };
    return { kind: 'wait', wait: { kind: 'timer', wakeAt }, reason: `until ${wakeAt.toISOString()}` };
  }

  private async executeAction(step: StepContext, node: Extract<JourneyNode, { type: 'action' }>): Promise<Outcome> {
    try {
      const output = await this.runAction(step, node);
      return { kind: 'advance', edge: 'next', to: node.next, output };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const permanent = isPermanentError(err);
      if (!permanent && node.retry === 'default' && step.attempt < MAX_ACTION_ATTEMPTS) {
        const delay = retryDelayMs(step.attempt) ?? 86_400_000;
        return { kind: 'retry', at: new Date(step.now.getTime() + delay), reason };
      }
      if (node.onFail === 'exit') return { kind: 'exit', reason: 'action_failed', output: { error: reason } };
      return { kind: 'advance', edge: 'next', to: node.next, output: { error: reason }, reason: `failed: ${reason}` };
    }
  }

  private async runAction(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'action' }>,
  ): Promise<Record<string, unknown>> {
    const ctx = getCurrentContext();
    const params = node.params;
    const contactId = step.enrollment.contactId;
    if (node.action !== 'webhook.post' && !contactId) {
      throw new BadRequestException('journeys_invalid: this enrollment has no CRM contact');
    }
    switch (node.action) {
      case 'crm.add_tag':
      case 'crm.remove_tag': {
        const [contact] = await ctx.db
          .select({ tags: schema.crmContacts.tags })
          .from(schema.crmContacts)
          .where(eq(schema.crmContacts.id, contactId!))
          .limit(1);
        if (!contact) throw new NotFoundException(`journeys_not_found: contact ${contactId}`);
        const tag = String(params.tag);
        const tags =
          node.action === 'crm.add_tag'
            ? Array.from(new Set([...contact.tags, tag]))
            : contact.tags.filter((t) => t !== tag);
        if (tags.length !== contact.tags.length) {
          await this.crm.updateContact({ id: contactId!, patch: { tags } });
        }
        return { tag, tags };
      }
      case 'crm.update_contact': {
        const fields = (params.fields ?? {}) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const key of ['name', 'title', 'phone', 'address'] as const) {
          if (typeof fields[key] === 'string') patch[key] = fields[key];
        }
        if (fields.customFields && typeof fields.customFields === 'object') {
          const [contact] = await ctx.db
            .select({ customFields: schema.crmContacts.customFields })
            .from(schema.crmContacts)
            .where(eq(schema.crmContacts.id, contactId!))
            .limit(1);
          patch.customFields = { ...(contact?.customFields ?? {}), ...(fields.customFields as Record<string, unknown>) };
        }
        await this.crm.updateContact({ id: contactId!, patch });
        return { updated: Object.keys(patch) };
      }
      case 'crm.log_activity': {
        const activity = await this.crm.logActivity({
          type: 'note',
          subject: String(params.subject),
          body: typeof params.body === 'string' ? params.body : undefined,
          contactId: contactId!,
          metadata: { journeyId: step.enrollment.journeyId, nodeId: step.node.id },
        });
        return { activityId: activity.id };
      }
      case 'webhook.post': {
        const [webhook] = await ctx.db
          .select({ id: schema.webhooks.id, active: schema.webhooks.active })
          .from(schema.webhooks)
          .where(eq(schema.webhooks.id, String(params.webhookId)))
          .limit(1);
        if (!webhook) throw new NotFoundException(`journeys_not_found: webhook ${String(params.webhookId)}`);
        const [event] = await ctx.db
          .insert(schema.events)
          .values({
            orgId: ctx.actor!.orgId,
            type: 'journey.action.webhook',
            actorId: JOURNEY_RUNTIME_ACTOR_ID,
            correlationId: ctx.correlationId,
            hopCount: step.hop,
            payload: {
              journeyId: step.enrollment.journeyId,
              enrollmentId: step.enrollment.id,
              nodeId: step.node.id,
              contactId: step.enrollment.contactId,
              endUserId: step.enrollment.endUserId,
              data: (params.data ?? {}),
            },
          })
          .returning({ id: schema.events.id });
        await ctx.db
          .insert(schema.webhookDeliveries)
          .values({ webhookId: webhook.id, eventId: event!.id, nextAttemptAt: new Date() });
        return { eventId: event!.id };
      }
    }
  }


  async listEnrollments(input: {
    journeyId: string;
    state?: EnrollmentState;
    contactId?: string;
    limit?: number;
  }): Promise<EnrollmentDto[]> {
    const ctx = getCurrentContext();
    const e = schema.journeyEnrollments;
    const filters: SQL[] = [eq(e.orgId, ctx.actor!.orgId), eq(e.journeyId, input.journeyId)];
    if (input.state) filters.push(eq(e.state, input.state));
    if (input.contactId) filters.push(eq(e.contactId, input.contactId));
    const rows = await ctx.db
      .select()
      .from(e)
      .where(and(...filters))
      .orderBy(desc(e.enteredAt))
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
    return rows.map(toEnrollmentDto);
  }

  async getTrace(enrollmentId: string): Promise<TraceDto> {
    const enrollment = await this.loadEnrollment(enrollmentId);
    const ctx = getCurrentContext();
    const steps = await ctx.db
      .select()
      .from(schema.journeyStepRuns)
      .where(eq(schema.journeyStepRuns.enrollmentId, enrollmentId))
      .orderBy(asc(schema.journeyStepRuns.startedAt), asc(schema.journeyStepRuns.visit));
    const waits = await ctx.db
      .select()
      .from(schema.journeyWaits)
      .where(and(eq(schema.journeyWaits.enrollmentId, enrollmentId), isNull(schema.journeyWaits.resolvedAt)));
    return {
      enrollment: toEnrollmentDto(enrollment),
      context: enrollment.context,
      steps: steps.map((s) => ({
        nodeId: s.nodeId,
        nodeType: s.nodeType,
        visit: s.visit,
        attempt: s.attempt,
        status: s.status,
        edgeTaken: s.edgeTaken,
        reason: s.reason,
        input: s.input,
        output: s.output,
        proposalId: s.proposalId,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
      })),
      openWaits: waits.map((w) => ({
        kind: w.kind,
        wakeAt: w.wakeAt?.toISOString() ?? null,
        eventKey: w.eventKey,
        timeoutAt: w.timeoutAt?.toISOString() ?? null,
      })),
    };
  }

  async eject(enrollmentId: string, reason = 'ejected'): Promise<EnrollmentDto> {
    const enrollment = await this.loadEnrollment(enrollmentId);
    if (!isOpen(enrollment.state)) {
      throw new ConflictException(`journeys_conflict: enrollment ${enrollmentId} already ended (${enrollment.exitReason})`);
    }
    await this.finish(enrollment, reason, 0);
    return toEnrollmentDto(await this.loadEnrollment(enrollmentId));
  }


  async spec(journeyId: string, version: number): Promise<JourneySpec> {
    const key = `${journeyId}@${version}`;
    const cached = this.specCache.get(key);
    if (cached) return cached;
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ spec: schema.journeyVersions.spec, publishedAt: schema.journeyVersions.publishedAt })
      .from(schema.journeyVersions)
      .where(and(eq(schema.journeyVersions.journeyId, journeyId), eq(schema.journeyVersions.number, version)))
      .limit(1);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${journeyId} has no version ${version}`);
    const spec = JourneySpecSchema.parse(row.spec);
    if (row.publishedAt) this.specCache.set(key, spec);
    return spec;
  }

  private async liveJourneys() {
    const ctx = getCurrentContext();
    return ctx.db
      .select({ id: schema.journeys.id, liveVersion: schema.journeys.liveVersion })
      .from(schema.journeys)
      .where(and(eq(schema.journeys.orgId, ctx.actor!.orgId), eq(schema.journeys.status, 'live')));
  }

  private async subjectFromPayload(payload: Record<string, unknown>): Promise<Subject> {
    const contactId = typeof payload.contactId === 'string' ? payload.contactId : null;
    const endUserId = typeof payload.endUserId === 'string' ? payload.endUserId : null;
    if (contactId || endUserId) return { contactId, endUserId };
    if (typeof payload.conversationId === 'string') {
      const ctx = getCurrentContext();
      const [conversation] = await ctx.db
        .select({ endUserId: schema.convConversations.endUserId })
        .from(schema.convConversations)
        .where(eq(schema.convConversations.id, payload.conversationId))
        .limit(1);
      return { contactId: null, endUserId: conversation?.endUserId ?? null };
    }
    return { contactId: null, endUserId: null };
  }

  private async completeSubject(subject: Subject): Promise<Subject> {
    const ctx = getCurrentContext();
    const c = schema.crmContacts;
    if (subject.contactId && !subject.endUserId) {
      const [row] = await ctx.db.select({ endUserId: c.endUserId }).from(c).where(eq(c.id, subject.contactId)).limit(1);
      return { contactId: subject.contactId, endUserId: row?.endUserId ?? null };
    }
    if (!subject.contactId && subject.endUserId) {
      const [row] = await ctx.db
        .select({ id: c.id })
        .from(c)
        .where(and(eq(c.orgId, ctx.actor!.orgId), eq(c.endUserId, subject.endUserId)))
        .orderBy(asc(c.createdAt))
        .limit(1);
      return { contactId: row?.id ?? null, endUserId: subject.endUserId };
    }
    return subject;
  }

  private async subjectEnrollments(subject: Subject, payload: Record<string, unknown>): Promise<EnrollmentRow[]> {
    const ctx = getCurrentContext();
    const e = schema.journeyEnrollments;
    const matches: SQL[] = [];
    if (subject.contactId) matches.push(eq(e.contactId, subject.contactId));
    if (subject.endUserId) matches.push(eq(e.endUserId, subject.endUserId));
    if (typeof payload.conversationId === 'string') matches.push(eq(e.conversationId, payload.conversationId));
    if (matches.length === 0) return [];
    return ctx.db
      .select()
      .from(e)
      .where(and(eq(e.orgId, ctx.actor!.orgId), or(...matches)));
  }

  async contactInSegment(contactId: string, segmentId: string): Promise<boolean> {
    const ctx = getCurrentContext();
    const [segment] = await ctx.db
      .select({ filter: schema.crmSegments.filterDefinition })
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, segmentId))
      .limit(1);
    if (!segment) return false;
    const [row] = await ctx.db
      .select({ id: schema.crmContacts.id })
      .from(schema.crmContacts)
      .where(
        and(
          eq(schema.crmContacts.id, contactId),
          ...OUTREACH_ELIGIBILITY_FLOOR,
          ...segmentMatchFilters(segment.filter),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async segmentContacts(segmentId: string, limit: number): Promise<string[]> {
    const ctx = getCurrentContext();
    const [segment] = await ctx.db
      .select({ filter: schema.crmSegments.filterDefinition })
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, segmentId))
      .limit(1);
    if (!segment) return [];
    const rows = await ctx.db
      .select({ id: schema.crmContacts.id })
      .from(schema.crmContacts)
      .where(
        and(
          eq(schema.crmContacts.orgId, ctx.actor!.orgId),
          ...OUTREACH_ELIGIBILITY_FLOOR,
          ...segmentMatchFilters(segment.filter),
        ),
      )
      .orderBy(asc(schema.crmContacts.createdAt))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  private async loadFacts(step: StepContext, conditions: Parameters<typeof collectConditionNeeds>[0][]): Promise<ConditionFacts> {
    return this.conditionFacts(
      {
        contactId: step.enrollment.contactId,
        endUserId: step.enrollment.endUserId,
        context: step.enrollment.context,
        enteredAt: step.enrollment.enteredAt,
        now: step.now,
        spec: step.spec,
      },
      conditions,
    );
  }

  async conditionFacts(
    enrollment: {
      contactId: string | null;
      endUserId: string | null;
      context: Record<string, unknown>;
      enteredAt: Date;
      now: Date;
      spec: JourneySpec;
    },
    conditions: Parameters<typeof collectConditionNeeds>[0][],
  ): Promise<ConditionFacts> {
    const ctx = getCurrentContext();
    const needs = { eventNames: new Set<string>(), segmentIds: new Set<string>() };
    for (const cond of conditions) collectConditionNeeds(cond, needs);
    const contact = enrollment.contactId
      ? ((
          await ctx.db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, enrollment.contactId)).limit(1)
        )[0] ?? null)
      : null;
    const company = contact?.companyId
      ? ((
          await ctx.db.select().from(schema.crmCompanies).where(eq(schema.crmCompanies.id, contact.companyId)).limit(1)
        )[0] ?? null)
      : null;

    let events: { name: string; occurredAt: Date }[] = [];
    if (needs.eventNames.size > 0 && (enrollment.contactId || enrollment.endUserId)) {
      const pe = schema.analyticsProductEvents;
      const who: SQL[] = [];
      if (enrollment.contactId) who.push(eq(pe.contactId, enrollment.contactId));
      if (enrollment.endUserId) who.push(eq(pe.endUserId, enrollment.endUserId));
      events = await ctx.db
        .select({ name: pe.name, occurredAt: pe.occurredAt })
        .from(pe)
        .where(and(eq(pe.orgId, ctx.actor!.orgId), inArray(pe.name, [...needs.eventNames]), or(...who)));
    }

    const segments = new Set<string>();
    if (enrollment.contactId) {
      for (const segmentId of needs.segmentIds) {
        if (await this.contactInSegment(enrollment.contactId, segmentId)) segments.add(segmentId);
      }
    }

    return {
      contact: contact as Record<string, unknown> | null,
      company: company as Record<string, unknown> | null,
      tags: contact?.tags ?? [],
      context: enrollment.context,
      events,
      segments,
      enteredAt: enrollment.enteredAt,
      now: enrollment.now,
      timezone: resolveTimezone(contact?.customFields, enrollment.spec),
    };
  }

  private async timezoneFor(step: StepContext, customFields?: Record<string, unknown>): Promise<string> {
    let fields = customFields;
    if (!fields && step.enrollment.contactId) {
      const ctx = getCurrentContext();
      const [row] = await ctx.db
        .select({ customFields: schema.crmContacts.customFields })
        .from(schema.crmContacts)
        .where(eq(schema.crmContacts.id, step.enrollment.contactId))
        .limit(1);
      fields = row?.customFields;
    }
    return resolveTimezone(fields, step.spec);
  }

  private async readDateField(step: StepContext, field: string): Promise<Date | null> {
    const [root, ...rest] = field.split('.');
    let source: Record<string, unknown> | null = null;
    if (root === 'context') source = step.enrollment.context;
    else if (step.enrollment.contactId) {
      const ctx = getCurrentContext();
      const [row] = await ctx.db
        .select()
        .from(schema.crmContacts)
        .where(eq(schema.crmContacts.id, step.enrollment.contactId))
        .limit(1);
      if (row && rest[0] === 'custom_fields') {
        source = row.customFields;
        rest.shift();
      } else {
        source = (row as Record<string, unknown> | undefined) ?? null;
      }
    }
    let value: unknown = source;
    for (const key of rest) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    return parseDate(value);
  }

  private async insertStepRun(
    enrollment: EnrollmentRow,
    node: JourneyNode,
    visit: number,
    input: Record<string, unknown>,
  ): Promise<string> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .insert(schema.journeyStepRuns)
      .values({
        orgId: enrollment.orgId,
        enrollmentId: enrollment.id,
        nodeId: node.id,
        nodeType: node.type,
        visit,
        status: 'running',
        input,
      })
      .returning({ id: schema.journeyStepRuns.id });
    return row!.id;
  }

  private async updateStepRun(
    id: string,
    patch: {
      status: string;
      attempt: number;
      output?: Record<string, unknown>;
      edgeTaken?: string | null;
      reason?: string | null;
      finished?: boolean;
    },
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .update(schema.journeyStepRuns)
      .set({
        status: patch.status,
        attempt: patch.attempt,
        ...(patch.output ? { output: patch.output } : {}),
        ...(patch.edgeTaken !== undefined ? { edgeTaken: patch.edgeTaken } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
        ...(patch.finished ? { finishedAt: new Date() } : {}),
      })
      .where(eq(schema.journeyStepRuns.id, id));
  }

  private async openWait(enrollment: EnrollmentRow, stepRunId: string, wait: WaitSpec): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.journeyWaits).values({
      orgId: enrollment.orgId,
      enrollmentId: enrollment.id,
      stepRunId,
      kind: wait.kind,
      wakeAt: wait.wakeAt ?? null,
      eventKey: wait.eventKey ?? null,
      match: wait.match ?? {},
      timeoutAt: wait.timeoutAt ?? null,
    });
    await ctx.db
      .update(schema.journeyEnrollments)
      .set({ state: 'waiting', nextRunAt: null, updatedAt: new Date() })
      .where(eq(schema.journeyEnrollments.id, enrollment.id));
  }

  private async resolveWait(wait: WaitRow, resolution: string, context?: Record<string, unknown>): Promise<void> {
    const ctx = getCurrentContext();
    const [resolved] = await ctx.db
      .update(schema.journeyWaits)
      .set({ resolvedAt: new Date(), resolution })
      .where(and(eq(schema.journeyWaits.id, wait.id), isNull(schema.journeyWaits.resolvedAt)))
      .returning({ id: schema.journeyWaits.id });
    if (!resolved) return;
    const e = schema.journeyEnrollments;
    const [enrollment] = await ctx.db.select().from(e).where(eq(e.id, wait.enrollmentId)).limit(1);
    if (!enrollment || enrollment.state !== 'waiting') return;
    const open = await ctx.db
      .select({ kind: schema.journeyWaits.kind })
      .from(schema.journeyWaits)
      .where(and(eq(schema.journeyWaits.enrollmentId, enrollment.id), isNull(schema.journeyWaits.resolvedAt)));
    const held = open.some((o) => o.kind === 'conversation_close');
    const stillWaiting = wait.kind === 'conversation_close' ? open.length > 0 : held;
    if (stillWaiting) {
      if (context) {
        await ctx.db
          .update(e)
          .set({ context: { ...enrollment.context, ...context }, updatedAt: new Date() })
          .where(eq(e.id, enrollment.id));
      }
      return;
    }
    await ctx.db
      .update(e)
      .set({
        state: 'active',
        nextRunAt: new Date(),
        ...(context ? { context: { ...enrollment.context, ...context } } : {}),
        updatedAt: new Date(),
      })
      .where(eq(e.id, enrollment.id));
  }

  private async latestWait(stepRunId: string): Promise<WaitRow | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.journeyWaits)
      .where(and(eq(schema.journeyWaits.stepRunId, stepRunId), ne(schema.journeyWaits.kind, 'conversation_close')))
      .orderBy(desc(schema.journeyWaits.createdAt))
      .limit(1);
    return row?.resolvedAt ? row : null;
  }

  private async markGoal(enrollment: EnrollmentRow, goal: string, hop: number): Promise<void> {
    const ctx = getCurrentContext();
    const [updated] = await ctx.db
      .update(schema.journeyEnrollments)
      .set({ goalReachedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.journeyEnrollments.id, enrollment.id), isNull(schema.journeyEnrollments.goalReachedAt)))
      .returning({ id: schema.journeyEnrollments.id });
    if (!updated) return;
    await this.webhooks.emit({
      type: 'journey.goal.reached',
      payload: {
        journeyId: enrollment.journeyId,
        enrollmentId: enrollment.id,
        goal,
        holdout: enrollment.holdout,
        contactId: enrollment.contactId,
      },
      hopCount: hop,
    });
  }

  private async finish(enrollment: EnrollmentRow, reason: string, hop: number): Promise<void> {
    const ctx = getCurrentContext();
    const now = new Date();
    const [updated] = await ctx.db
      .update(schema.journeyEnrollments)
      .set({
        state: COMPLETED_REASONS.has(reason) ? 'done' : 'exited',
        exitReason: reason,
        exitedAt: now,
        nextRunAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.journeyEnrollments.id, enrollment.id),
          inArray(schema.journeyEnrollments.state, ['active', 'waiting']),
        ),
      )
      .returning({ id: schema.journeyEnrollments.id });
    if (!updated) return;
    await ctx.db
      .update(schema.journeyWaits)
      .set({ resolvedAt: now, resolution: 'cancelled' })
      .where(and(eq(schema.journeyWaits.enrollmentId, enrollment.id), isNull(schema.journeyWaits.resolvedAt)));
    await this.webhooks.emit({
      type: 'journey.exited',
      payload: {
        journeyId: enrollment.journeyId,
        enrollmentId: enrollment.id,
        reason,
        contactId: enrollment.contactId,
        endUserId: enrollment.endUserId,
      },
      hopCount: hop,
    });
  }

  private async loadEnrollment(id: string): Promise<EnrollmentRow> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.journeyEnrollments)
      .where(and(eq(schema.journeyEnrollments.orgId, ctx.actor!.orgId), eq(schema.journeyEnrollments.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException(`journeys_not_found: enrollment ${id}`);
    return row;
  }
}

function subjectKeyOf(subject: Subject): string | null {
  if (subject.contactId) return `c:${subject.contactId}`;
  if (subject.endUserId) return `eu:${subject.endUserId}`;
  return null;
}

function isOpen(state: string): boolean {
  return state === 'active' || state === 'waiting';
}

function payloadMatches(
  payload: Record<string, unknown>,
  where: Record<string, string | number | boolean> | undefined,
): boolean {
  if (!where) return true;
  const properties = (payload.properties ?? {}) as Record<string, unknown>;
  return Object.entries(where).every(([key, expected]) => {
    const actual = key in payload ? payload[key] : properties[key];
    return actual === expected;
  });
}

function edgeTarget(node: JourneyNode, edge: string): string | undefined {
  switch (node.type) {
    case 'message':
      return edge === 'on_reply' ? node.onReply : node.next;
    case 'wait_for':
      return edge === 'on_timeout' ? node.onTimeout : node.next;
    case 'branch':
      if (edge === 'default') return node.default;
      return node.rules[Number(edge.replace('rule_', '')) - 1]?.next;
    case 'split':
      return node.paths.find((p) => p.name === edge)?.next;
    case 'jump':
      return node.to;
    case 'action':
    case 'wait':
    case 'goal':
      return node.next;
    default:
      return undefined;
  }
}

function nextScheduledEntry(
  trigger: Extract<JourneySpec['entry']['trigger'], { type: 'segment' }>,
  now: Date,
): Date | null {
  if (trigger.schedule === 'once') return null;
  const days = trigger.schedule === 'daily' ? 1 : 7;
  return new Date(now.getTime() + days * 86_400_000);
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

function resolveTimezone(fields: Record<string, unknown> | undefined, spec: JourneySpec): string {
  const candidate = typeof fields?.timezone === 'string' ? fields.timezone : spec.settings.timezone;
  return candidate && isValidTimezone(candidate) ? candidate : 'UTC';
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isPermanentError(err: unknown): boolean {
  return err instanceof BadRequestException || err instanceof NotFoundException || err instanceof ConflictException;
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

function toEnrollmentDto(row: EnrollmentRow): EnrollmentDto {
  return {
    id: row.id,
    journeyId: row.journeyId,
    version: row.version,
    contactId: row.contactId,
    endUserId: row.endUserId,
    state: row.state as EnrollmentState,
    currentNode: row.currentNode,
    holdout: row.holdout,
    enteredAt: row.enteredAt.toISOString(),
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    goalReachedAt: row.goalReachedAt?.toISOString() ?? null,
    exitedAt: row.exitedAt?.toISOString() ?? null,
    exitReason: row.exitReason,
  };
}

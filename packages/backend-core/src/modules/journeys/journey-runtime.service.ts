import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { getCurrentContext, readApiBaseUrl, WebhookDispatcher, withContext } from '@getmunin/core';
import { createHash, randomUUID } from 'node:crypto';
import {
  CALL_OUTCOMES,
  JOURNEY_CALL_OPENING_MAX_CHARS,
  JOURNEY_CHAT_MAX_CHARS,
  JOURNEY_SMS_MAX_CHARS,
  JourneySpecSchema,
  MAX_CONCURRENT_ENROLLMENTS,
  MAX_SUB_JOURNEY_DEPTH,
  parseIsoDurationMs,
  type JourneyNode,
  type JourneySpec,
} from '@getmunin/types';
import { CrmService } from '../crm/crm.service.ts';
import { OutreachService } from '../outreach/outreach.service.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { buildAgentInputs, buildDecidePrompt, buildDraftPrompt, buildEnrichPrompt } from './journey-agent-inputs.ts';
import { OUTREACH_ELIGIBILITY_FLOOR, segmentMatchFilters } from '../crm/segment-filter.ts';
import { collectConditionNeeds, evaluateCondition, type ConditionFacts } from './journey-conditions.ts';
import { JOURNEY_RUNTIME_ACTOR_ID, journeyEventKey } from './journey-event.sink.ts';
import { MAX_ACTION_ATTEMPTS, nextLocalOccurrence, nextValidTime, parseZonedDate, retryDelayMs, stableBucket } from './journey-time.ts';

export const ENROLLMENT_STATES = ['active', 'waiting', 'done', 'exited'] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

const MAX_NODES_PER_RUN = 50;
const COMPLETED_REASONS: ReadonlySet<string> = new Set(['reached_end', 'goal_reached']);
const APPROVAL_TIMEOUT_MS = 7 * 86_400_000;
export const DECIDE_STEP_JOB_URI = 'skill://journeys/decide-step';
export const STOP_EDGE = 'stop';
export const DRAFT_STEP_JOB_URI = 'skill://journeys/draft-step';
export const ENRICH_STEP_JOB_URI = 'skill://journeys/enrich-step';
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
  companyId?: string | null;
}

export interface MoveEnrollmentsResult {
  toVersion: number;
  fingerprint: string;
  moved: number;
  movable: number;
  byNode: Record<string, { to: string; count: number; resumes: boolean }>;
  skipped: { enrollmentId: string; node: string; reason: string }[];
  applied: boolean;
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
  contactName?: string | null;
  contactEmail?: string | null;
  endUserId: string | null;
  companyId: string | null;
  companyName?: string | null;
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
  agent?: { jobId: string; status: string; totalTokens: number | null; tier: 'fast' | 'smart' } | null;
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
  kind: 'timer' | 'event' | 'proposal' | 'conversation_close' | 'agent' | 'approval';
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

interface JourneyReplyHandover {
  requestHandover(input: { conversationId: string; reason?: string }): Promise<unknown>;
}

@Injectable()
export class JourneyRuntimeService {
  private readonly specCache = new Map<string, JourneySpec>();

  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(OutreachService) private readonly outreach: OutreachService,
    @Inject(CuratorJobsService) private readonly curatorJobs: Pick<CuratorJobsService, 'enqueue'>,
    @Inject(ConvService) private readonly conv: JourneyReplyHandover,
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

    await this.assertSubjectExists(input.subject);
    const byCompany = spec.entry.subject === 'company';
    const subject: Subject = byCompany
      ? { contactId: null, endUserId: null, companyId: await this.subjectCompany(input.subject) }
      : { ...(await this.completeSubject(input.subject)), companyId: null };
    if (byCompany && !subject.companyId) return { status: 'skipped', reason: 'no_company' };
    const subjectKey = subjectKeyOf(subject);
    if (!subjectKey) return { status: 'skipped', reason: 'no_subject' };

    if (spec.entry.segmentId) {
      const inSegment = subject.companyId
        ? await this.companyInSegment(subject.companyId, spec.entry.segmentId)
        : subject.contactId
          ? await this.contactInSegment(subject.contactId, spec.entry.segmentId)
          : false;
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
    const concurrent = spec.entry.reentry === 'concurrent';
    const open = await ctx.db
      .select({ id: e.id, entryKey: e.entryKey })
      .from(e)
      .where(and(eq(e.journeyId, journey.id), eq(e.subjectKey, subjectKey), inArray(e.state, ['active', 'waiting'])))
      .limit(MAX_CONCURRENT_ENROLLMENTS);
    const eventId = input.source.eventId;
    const entryKey = concurrent ? (typeof eventId === 'string' ? eventId : randomUUID()) : '';
    const same = open.find((o) => o.entryKey === entryKey);
    if (same) return { status: 'skipped', reason: 'already_active', enrollmentId: same.id };
    if (concurrent) {
      const [seen] = await ctx.db
        .select({ id: e.id })
        .from(e)
        .where(and(eq(e.journeyId, journey.id), eq(e.subjectKey, subjectKey), eq(e.entryKey, entryKey)))
        .limit(1);
      if (seen) return { status: 'skipped', reason: 'already_enrolled', enrollmentId: seen.id };
    }
    if (spec.goal && !concurrent) {
      const [heldOut] = await ctx.db
        .select({ id: e.id })
        .from(e)
        .where(
          and(
            eq(e.journeyId, journey.id),
            eq(e.subjectKey, subjectKey),
            eq(e.holdout, true),
            gte(e.enteredAt, new Date(now.getTime() - spec.goal.windowDays * 86_400_000)),
          ),
        )
        .limit(1);
      if (heldOut) return { status: 'skipped', reason: 'in_holdout', enrollmentId: heldOut.id };
    }
    if (!concurrent && open[0]) return { status: 'skipped', reason: 'already_active', enrollmentId: open[0].id };
    if (open.length >= MAX_CONCURRENT_ENROLLMENTS) return { status: 'skipped', reason: 'concurrency_cap' };

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
        companyId: subject.companyId ?? null,
        subjectKey,
        entryKey,
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
      const exclude = { journeyId: journey.id, reentry: spec.entry.reentry, since: journey.nextEntryAt };
      const byCompany = spec.entry.subject === 'company';
      const subjects: Subject[] = byCompany
        ? (await this.segmentCompanies(trigger.segmentId, limit, exclude)).map((companyId) => ({ contactId: null, endUserId: null, companyId }))
        : (await this.segmentContacts(trigger.segmentId, limit, exclude)).map((contactId) => ({ contactId, endUserId: null }));
      for (const subject of subjects) {
        const result = await this.inSavepoint(() =>
          this.enroll({
            journeyId: journey.id,
            subject,
            source: { type: 'segment', segmentId: trigger.segmentId },
          }),
        ).catch((): EnrollResult => ({ status: 'skipped', reason: 'enroll_failed' }));
        if (result.status === 'enrolled') enrolled += 1;
      }
      const more = subjects.length >= limit;
      await ctx.db
        .update(j)
        .set({
          nextEntryAt: more ? journey.nextEntryAt : nextScheduledEntry(trigger, now, spec.settings.timezone),
          updatedAt: new Date(),
        })
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

    if (row.actorId !== JOURNEY_RUNTIME_ACTOR_ID && (subject.contactId || subject.endUserId || subject.companyId)) {
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
      if (enrollment.source.eventId === row.eventId || occurredAt.getTime() < enrollment.enteredAt.getTime()) continue;
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
        .select({ status: schema.journeys.status, pausedNodes: schema.journeys.pausedNodes })
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

      if (!existing && journey.pausedNodes[node.id]) {
        await ctx.db.update(e).set({ nextRunAt: null, updatedAt: new Date() }).where(eq(e.id, enrollment.id));
        return;
      }

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
        const control = node.control ? node.paths.find((p) => p.name === node.control) : undefined;
        if (control && node.sampleSize && (await this.splitArrivals(step, node.id)) >= node.sampleSize) {
          return { kind: 'advance', edge: control.name, to: control.next, output: { bucket, sampleFull: true } };
        }
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
      case 'agent':
        return this.executeAgent(step, node);
      case 'approval':
        return this.executeApproval(step, node);
      case 'sub_journey':
        return this.executeSubJourney(step, node);
      default:
        return { kind: 'exit', reason: 'node_type_unavailable' };
    }
  }

  private async executeMessage(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'message' }>,
  ): Promise<Outcome> {
    if (step.enrollment.companyId && !step.enrollment.contactId) return this.executeCompanyMessage(step, node);
    const previous = await this.stepOutput(step.stepRunId);
    let content: { subject: string | null; body: string; format: 'markdown' | 'mjml' } = {
      subject: node.content.subject ?? null,
      body: node.content.body,
      format: node.content.format,
    };
    let citations: unknown[] | undefined;
    if (node.draftBy === 'agent' && !previous.proposalId) {
      if (!step.resumed) {
        if (node.approval === 'off') return { kind: 'advance', edge: 'next', to: node.next, reason: 'approval off' };
        const inputs = await buildAgentInputs(node.draftInputs ?? ['contact', 'events'], this.agentSubject(step));
        return this.requestAgent(step, {
          jobUri: DRAFT_STEP_JOB_URI,
          prompt: buildDraftPrompt({ node, journeyName: await this.journeyName(step.enrollment.journeyId), inputs }),
          timeout: node.draftTimeout,
          output: { draftRequested: true, inputs: node.draftInputs ?? ['contact', 'events'] },
          reason: 'waiting for the agent to draft',
        });
      }
      const draft = previous.draft as { subject?: string | null; body?: string; citations?: unknown[] } | undefined;
      const usable = draft?.body && (node.channel !== 'email' || draft.subject);
      if (step.resumed.resolution === 'agent_drafted' && usable) {
        content = { subject: node.channel === 'email' ? draft.subject! : null, body: draft.body!, format: 'markdown' };
        citations = draft.citations;
      }
    } else if (step.resumed) {
      if (node.channel === 'chat' && previous.awaitingSeen) {
        const seen = step.resumed.resolution === 'event';
        const unseenTo = seen ? undefined : node.onUnseen;
        return {
          kind: 'advance',
          edge: unseenTo ? 'on_unseen' : 'next',
          to: unseenTo ?? node.next,
          output: { ...previous, seen },
          reason: seen ? 'chat message seen' : 'chat message not seen in time',
        };
      }
      if (node.channel === 'voice' && previous.awaitingOutcome) {
        const event = step.enrollment.context.lastEvent as { payload?: { outcome?: unknown } } | undefined;
        const reported = event?.payload?.outcome;
        const outcome = step.resumed.resolution !== 'event' ? 'timeout' : typeof reported === 'string' ? reported : '';
        const known = (CALL_OUTCOMES as readonly string[]).includes(outcome) || outcome === 'timeout';
        const mapped = known ? node.onOutcome?.[outcome as keyof NonNullable<typeof node.onOutcome>] : undefined;
        return {
          kind: 'advance',
          edge: mapped ? `outcome_${outcome}` : 'next',
          to: mapped ?? node.next,
          output: { ...previous, outcome },
          reason: outcome === 'timeout' ? 'no call outcome in time' : `call outcome: ${outcome}`,
        };
      }
      switch (step.resumed.resolution) {
        case 'proposal_sent':
          if (node.channel === 'voice') {
            return {
              kind: 'wait',
              wait: {
                kind: 'event',
                eventKey: 'outreach.outcome.recorded',
                match: {
                  contactId: step.enrollment.contactId ?? '',
                  conversationId: (await this.proposalConversation(previous.proposalId)) ?? '',
                },
                timeoutAt: new Date(step.now.getTime() + (parseIsoDurationMs(node.outcomeTimeout ?? 'PT6H') ?? 21_600_000)),
              },
              output: { ...previous, awaitingOutcome: true },
              reason: 'waiting for the call outcome',
            };
          }
          if (node.channel === 'chat') return this.awaitChatSeen(step, node, previous, previous.proposalId);
          return { kind: 'advance', edge: 'next', to: node.next, reason: step.resumed.resolution };
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
    const sms = node.channel !== 'email';
    const proposal = await this.outreach.proposeJourneyMessage(
      {
        campaignId: journey!.campaignId,
        channel: node.channel,
        channelId:
          node.channel === 'sms'
          ? (settings.smsChannelId ?? null)
          : node.channel === 'voice'
            ? (settings.voiceChannelId ?? null)
            : node.channel === 'chat'
              ? (settings.chatChannelId ?? null)
              : null,
        contactId,
        enrollmentId: step.enrollment.id,
        stepRunId: step.stepRunId,
        subject: content.subject,
        body: content.body,
        format: content.format,
        templateId: node.content.templateId,
        templateHash: node.approval === 'auto' ? await this.pinnedTemplateHash(step, node.id) : null,
        preheader: node.content.preheader,
        auto: (node.channel === 'email' || node.channel === 'chat') && node.approval === 'auto',
        policy: {
          channel: node.channel,
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
          ...(node.draftBy === 'agent'
            ? { draftedBy: previous.draft ? 'agent' : 'fallback_content', brief: node.brief, citations: citations ?? [] }
            : {}),
        },
      },
      { publicBaseUrl: readApiBaseUrl() },
    );
    await ctx.db
      .update(schema.journeyStepRuns)
      .set({ proposalId: proposal.id })
      .where(eq(schema.journeyStepRuns.id, step.stepRunId));
    if (proposal.status === 'sent') {
      if (node.channel === 'chat') return this.awaitChatSeen(step, node, previous, proposal.id);
      if (!sms) await this.rememberThread(step.enrollment.id, proposal.conversationId);
      return { kind: 'advance', edge: 'next', to: node.next, output: { ...previous, proposalId: proposal.id }, reason: 'sent' };
    }
    if (proposal.status === 'failed') {
      return {
        kind: 'exit',
        reason: 'message_blocked',
        output: { ...previous, proposalId: proposal.id, error: proposal.failureReason },
      };
    }
    const base = proposal.scheduledSendAt ? new Date(proposal.scheduledSendAt) : step.now;
    return {
      kind: 'wait',
      wait: {
        kind: 'proposal',
        match: { proposalId: proposal.id },
        timeoutAt: new Date(base.getTime() + APPROVAL_TIMEOUT_MS),
      },
      output: { ...previous, proposalId: proposal.id, status: proposal.status },
      reason: proposal.status === 'approved' ? 'scheduled' : 'awaiting review',
    };
  }

  private async executeCompanyMessage(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'message' }>,
  ): Promise<Outcome> {
    if (step.resumed) return this.companyMessageOutcome(step, node, step.resumed.resolution);
    if (node.approval === 'off') return { kind: 'advance', edge: 'next', to: node.next, reason: 'approval off' };
    const recipients = await this.companyRecipients(step.enrollment.companyId!, node.recipients);
    if (recipients.length === 0) return { kind: 'exit', reason: 'no_recipients' };
    const ctx = getCurrentContext();
    const [journey] = await ctx.db
      .select({ campaignId: schema.journeys.outreachCampaignId })
      .from(schema.journeys)
      .where(eq(schema.journeys.id, step.enrollment.journeyId))
      .limit(1);
    const settings = step.spec.settings;
    const templateHash = node.approval === 'auto' ? await this.pinnedTemplateHash(step, node.id) : null;
    const proposalIds: string[] = [];
    for (const contactId of recipients) {
      const proposal = await this.outreach.proposeJourneyMessage(
        {
          campaignId: journey!.campaignId,
          channel: node.channel,
          channelId:
            node.channel === 'sms' ? (settings.smsChannelId ?? null) : node.channel === 'chat' ? (settings.chatChannelId ?? null) : null,
          contactId,
          enrollmentId: step.enrollment.id,
          stepRunId: step.stepRunId,
          subject: node.content.subject ?? null,
          body: node.content.body,
          format: node.content.format,
          templateId: node.content.templateId,
          templateHash,
          preheader: node.content.preheader,
          auto: (node.channel === 'email' || node.channel === 'chat') && node.approval === 'auto',
          policy: {
            channel: node.channel,
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
            companyId: step.enrollment.companyId,
          },
        },
        { publicBaseUrl: readApiBaseUrl() },
      );
      proposalIds.push(proposal.id);
    }
    await ctx.db
      .update(schema.journeyStepRuns)
      .set({ proposalId: proposalIds[0] ?? null })
      .where(eq(schema.journeyStepRuns.id, step.stepRunId));
    return this.companyMessageOutcome(step, node, null);
  }

  private async companyMessageOutcome(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'message' }>,
    resolution: string | null,
  ): Promise<Outcome> {
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const rows = await ctx.db
      .select({ id: p.id, contactId: p.contactId, status: p.status, scheduledSendAt: p.scheduledSendAt })
      .from(p)
      .where(eq(p.journeyStepRunId, step.stepRunId));
    const output = { proposals: rows.map((r) => ({ id: r.id, contactId: r.contactId, status: r.status })) };
    const open = rows.filter((r) => r.status === 'pending' || r.status === 'approved');
    const sent = rows.filter((r) => r.status === 'sent').length;
    if (open.length > 0 && resolution !== 'timeout') {
      const latest = Math.max(step.now.getTime(), ...open.map((r) => r.scheduledSendAt?.getTime() ?? 0));
      return {
        kind: 'wait',
        wait: { kind: 'proposal', match: { stepRunId: step.stepRunId }, timeoutAt: new Date(latest + APPROVAL_TIMEOUT_MS) },
        output,
        reason: `${open.length} of ${rows.length} messages awaiting review or sending`,
      };
    }
    if (sent > 0 || rows.some((r) => r.status === 'withdrawn')) {
      return { kind: 'advance', edge: 'next', to: node.next, output, reason: `sent to ${sent} of ${rows.length}` };
    }
    if (open.length > 0) return { kind: 'exit', reason: 'approval_timeout', output };
    if (rows.length > 0 && rows.every((r) => r.status === 'failed')) return { kind: 'exit', reason: 'message_blocked', output };
    return { kind: 'exit', reason: 'proposal_dismissed', output };
  }

  async companyRecipients(
    companyId: string,
    filter: { tag?: string; titleContains?: string; max: number } | undefined,
  ): Promise<string[]> {
    const ctx = getCurrentContext();
    const c = schema.crmContacts;
    const where: SQL[] = [eq(c.companyId, companyId), eq(c.doNotContact, false)];
    if (filter?.tag) where.push(sql`${c.tags} ? ${filter.tag}`);
    if (filter?.titleContains) where.push(sql`${c.title} ILIKE ${`%${filter.titleContains.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
    const rows = await ctx.db
      .select({ id: c.id })
      .from(c)
      .where(and(...where))
      .orderBy(sql`${c.lastContactedAt} DESC NULLS LAST`, asc(c.createdAt))
      .limit(filter?.max ?? 3);
    return rows.map((r) => r.id);
  }

  private async stepOutput(stepRunId: string): Promise<Record<string, unknown>> {
    const ctx = getCurrentContext();
    const [run] = await ctx.db
      .select({ output: schema.journeyStepRuns.output })
      .from(schema.journeyStepRuns)
      .where(eq(schema.journeyStepRuns.id, stepRunId))
      .limit(1);
    return run?.output ?? {};
  }

  private async requestAgent(
    step: StepContext,
    input: { jobUri: string; prompt: string; timeout: string; output: Record<string, unknown>; reason: string },
  ): Promise<Outcome> {
    const job = await this.curatorJobs.enqueue({
      jobUri: input.jobUri,
      userPrompt: input.prompt,
      sourceEventType: 'journey.agent.step',
      sourceEventPayload: {
        stepRunId: step.stepRunId,
        enrollmentId: step.enrollment.id,
        journeyId: step.enrollment.journeyId,
        nodeId: step.node.id,
      },
      dedupeKey: `journey-agent:${step.stepRunId}`,
    });
    const timeoutMs = parseIsoDurationMs(input.timeout) ?? 600_000;
    return {
      kind: 'wait',
      wait: { kind: 'agent', timeoutAt: new Date(step.now.getTime() + timeoutMs) },
      output: { ...input.output, curatorJobId: job.job.id },
      reason: input.reason,
    };
  }

  private async journeyName(journeyId: string): Promise<string> {
    const ctx = getCurrentContext();
    const [journey] = await ctx.db
      .select({ name: schema.journeys.name })
      .from(schema.journeys)
      .where(eq(schema.journeys.id, journeyId))
      .limit(1);
    return journey?.name ?? 'journey';
  }

  private agentSubject(step: StepContext) {
    return {
      contactId: step.enrollment.contactId,
      endUserId: step.enrollment.endUserId,
      companyId: step.enrollment.companyId,
      conversationId: step.enrollment.conversationId,
      context: step.enrollment.context,
    };
  }

  private async executeAgent(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'agent' }>,
  ): Promise<Outcome> {
    const previous = await this.stepOutput(step.stepRunId);
    if (node.mode === 'enrich') {
      if (step.resumed) {
        const enriched = step.resumed.resolution === 'agent_enriched';
        return {
          kind: 'advance',
          edge: 'next',
          to: node.next,
          output: previous,
          reason: enriched ? 'fields filled' : 'no fields in time',
        };
      }
      const inputs = await buildAgentInputs(node.inputs, this.agentSubject(step));
      return this.requestAgent(step, {
        jobUri: ENRICH_STEP_JOB_URI,
        prompt: buildEnrichPrompt({ node, journeyName: await this.journeyName(step.enrollment.journeyId), inputs }),
        timeout: node.timeout,
        output: { inputs: node.inputs },
        reason: 'waiting for the agent to fill fields',
      });
    }
    const edges = node.edges ?? {};
    const fallback = node.fallback ?? Object.keys(edges)[0]!;
    if (step.resumed) {
      const decision = previous.decision as { edge?: string; reason?: string } | undefined;
      if (step.resumed.resolution === 'agent_decided' && decision?.edge && decision.edge in edges) {
        if (decision.edge === STOP_EDGE) await this.exitOtherJourneys(step.enrollment, 'conversation_stop');
        return {
          kind: 'advance',
          edge: decision.edge,
          to: edges[decision.edge],
          output: previous,
          reason: decision.reason ?? 'agent decided',
        };
      }
      return {
        kind: 'advance',
        edge: fallback,
        to: edges[fallback],
        output: { ...previous, decision: { edge: fallback, fallback: true, reason: 'no decision in time' } },
        reason: 'fallback: no decision in time',
      };
    }
    const inputs = await buildAgentInputs(node.inputs, this.agentSubject(step));
    return this.requestAgent(step, {
      jobUri: DECIDE_STEP_JOB_URI,
      prompt: buildDecidePrompt({ node, journeyName: await this.journeyName(step.enrollment.journeyId), inputs }),
      timeout: node.timeout,
      output: { inputs: node.inputs },
      reason: 'waiting for the agent to decide',
    });
  }

  private async exitOtherJourneys(enrollment: EnrollmentRow, reason: string): Promise<number> {
    const ctx = getCurrentContext();
    const e = schema.journeyEnrollments;
    const who: SQL[] = [];
    if (enrollment.contactId) who.push(eq(e.contactId, enrollment.contactId));
    if (enrollment.endUserId) who.push(eq(e.endUserId, enrollment.endUserId));
    if (who.length === 0) return 0;
    const others = await ctx.db
      .select()
      .from(e)
      .where(
        and(
          eq(e.orgId, enrollment.orgId),
          inArray(e.state, ['active', 'waiting']),
          ne(e.id, enrollment.id),
          or(...who),
        ),
      );
    for (const other of others) await this.finish(other, reason, 1);
    return others.length;
  }

  async submitDecision(input: {
    stepRunId: string;
    edge: string;
    reason: string;
    confidence?: 'high' | 'medium' | 'low';
  }): Promise<{ accepted: true; edge: string; nextNode: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const sr = schema.journeyStepRuns;
    const [run] = await ctx.db
      .select()
      .from(sr)
      .where(and(eq(sr.orgId, actor.orgId), eq(sr.id, input.stepRunId)))
      .limit(1);
    if (!run || run.nodeType !== 'agent') {
      throw new NotFoundException(`journeys_not_found: agent step ${input.stepRunId}`);
    }
    await ctx.db.execute(sql`SELECT id FROM journey_enrollments WHERE id = ${run.enrollmentId} FOR UPDATE`);
    const [wait] = await ctx.db
      .select()
      .from(schema.journeyWaits)
      .where(
        and(
          eq(schema.journeyWaits.stepRunId, run.id),
          eq(schema.journeyWaits.kind, 'agent'),
          isNull(schema.journeyWaits.resolvedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!wait || run.status !== 'waiting') {
      throw new ConflictException(
        `journeys_conflict: step ${input.stepRunId} is no longer waiting for a decision (it was decided or timed out)`,
      );
    }
    const enrollment = await this.loadEnrollment(run.enrollmentId);
    const spec = await this.spec(enrollment.journeyId, enrollment.version);
    const node = spec.nodes.find((n) => n.id === run.nodeId);
    if (node?.type !== 'agent' || node.mode !== 'decide') {
      throw new NotFoundException(`journeys_not_found: agent decide node ${run.nodeId}`);
    }
    const nextNode = node.edges?.[input.edge];
    if (!nextNode) {
      throw new BadRequestException(
        `journeys_invalid: "${input.edge}" is not an edge of this step; choose one of ${Object.keys(node.edges ?? {}).join(', ')}`,
      );
    }
    await ctx.db
      .update(sr)
      .set({
        output: {
          ...run.output,
          decision: {
            edge: input.edge,
            reason: input.reason,
            confidence: input.confidence ?? null,
            decidedBy: actor.id,
            decidedAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(sr.id, run.id));
    await this.resolveWait(wait, 'agent_decided');
    return { accepted: true, edge: input.edge, nextNode };
  }

  private async waitingAgentStep(stepRunId: string, nodeType: 'message' | 'agent') {
    const ctx = getCurrentContext();
    const sr = schema.journeyStepRuns;
    const [run] = await ctx.db
      .select()
      .from(sr)
      .where(and(eq(sr.orgId, ctx.actor!.orgId), eq(sr.id, stepRunId)))
      .limit(1);
    if (!run || run.nodeType !== nodeType) {
      throw new NotFoundException(`journeys_not_found: agent step ${stepRunId}`);
    }
    await ctx.db.execute(sql`SELECT id FROM journey_enrollments WHERE id = ${run.enrollmentId} FOR UPDATE`);
    const [wait] = await ctx.db
      .select()
      .from(schema.journeyWaits)
      .where(
        and(
          eq(schema.journeyWaits.stepRunId, run.id),
          eq(schema.journeyWaits.kind, 'agent'),
          isNull(schema.journeyWaits.resolvedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!wait || run.status !== 'waiting') {
      throw new ConflictException(
        `journeys_conflict: step ${stepRunId} is no longer waiting for the agent (it was answered or timed out)`,
      );
    }
    const enrollment = await this.loadEnrollment(run.enrollmentId);
    const spec = await this.spec(enrollment.journeyId, enrollment.version);
    const node = spec.nodes.find((n) => n.id === run.nodeId);
    return { run, wait, enrollment, node };
  }

  async submitDraft(input: {
    stepRunId: string;
    subject?: string;
    body: string;
    citations?: { title: string; source: string }[];
  }): Promise<{ accepted: true }> {
    const ctx = getCurrentContext();
    const { run, wait, node } = await this.waitingAgentStep(input.stepRunId, 'message');
    if (node?.type !== 'message' || node.draftBy !== 'agent') {
      throw new NotFoundException(`journeys_not_found: agent-drafted message step ${input.stepRunId}`);
    }
    if (node.channel === 'email' && !input.subject) {
      throw new BadRequestException('journeys_invalid: an email draft needs a subject');
    }
    if (node.channel !== 'email' && input.subject) {
      throw new BadRequestException(`journeys_invalid: a ${node.channel} draft has no subject; send only the body`);
    }
    const limit = DRAFT_LIMITS[node.channel];
    if (input.body.length > limit) {
      throw new BadRequestException(
        `journeys_invalid: the ${node.channel} draft is ${input.body.length} characters; the limit is ${limit}`,
      );
    }
    await ctx.db
      .update(schema.journeyStepRuns)
      .set({
        output: {
          ...run.output,
          draft: {
            subject: input.subject ?? null,
            body: input.body,
            citations: input.citations ?? [],
            draftedBy: ctx.actor!.id,
            draftedAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(schema.journeyStepRuns.id, run.id));
    await this.resolveWait(wait, 'agent_drafted');
    return { accepted: true };
  }

  async submitFields(input: { stepRunId: string; fields: Record<string, unknown> }): Promise<{ accepted: true; written: string[] }> {
    const ctx = getCurrentContext();
    const { run, wait, enrollment, node } = await this.waitingAgentStep(input.stepRunId, 'agent');
    if (node?.type !== 'agent' || node.mode !== 'enrich') {
      throw new NotFoundException(`journeys_not_found: agent enrich step ${input.stepRunId}`);
    }
    const values: Record<string, unknown> = {};
    for (const field of node.fields ?? []) {
      if (!(field.key in input.fields)) continue;
      const value = coerceField(field, input.fields[field.key]);
      if (value === undefined) {
        throw new BadRequestException(`journeys_invalid: "${field.key}" is not a valid ${field.type}`);
      }
      if (value === null) continue;
      values[field.key] = value;
    }
    const unknown = Object.keys(input.fields).filter((k) => !(node.fields ?? []).some((f) => f.key === k));
    if (unknown.length) {
      throw new BadRequestException(`journeys_invalid: ${unknown.join(', ')} are not fields of this step`);
    }
    if (enrollment.contactId && Object.keys(values).length) {
      const [contact] = await ctx.db
        .select({ customFields: schema.crmContacts.customFields })
        .from(schema.crmContacts)
        .where(eq(schema.crmContacts.id, enrollment.contactId))
        .limit(1);
      await this.crm.updateContact({
        id: enrollment.contactId,
        patch: { customFields: { ...(contact?.customFields ?? {}), ...values } },
      });
    }
    await ctx.db
      .update(schema.journeyEnrollments)
      .set({ context: { ...enrollment.context, enriched: { ...(enrollment.context.enriched as object), ...values } } })
      .where(eq(schema.journeyEnrollments.id, enrollment.id));
    await ctx.db
      .update(schema.journeyStepRuns)
      .set({ output: { ...run.output, fields: values, filledBy: ctx.actor!.id } })
      .where(eq(schema.journeyStepRuns.id, run.id));
    await this.resolveWait(wait, 'agent_enriched');
    return { accepted: true, written: Object.keys(values) };
  }

  private async repliedStep(enrollmentId: string, conversationId: string): Promise<{ nodeId: string; id: string } | null> {
    const ctx = getCurrentContext();
    const r = schema.journeyStepRuns;
    const p = schema.outreachProposals;
    const [inThread] = await ctx.db
      .select({ nodeId: r.nodeId, id: r.id })
      .from(r)
      .innerJoin(p, eq(p.journeyStepRunId, r.id))
      .where(and(eq(r.enrollmentId, enrollmentId), eq(p.conversationId, conversationId)))
      .orderBy(sql`${p.sentAt} DESC NULLS LAST`)
      .limit(1);
    if (inThread) return inThread;
    const [latest] = await ctx.db
      .select({ nodeId: r.nodeId, id: r.id })
      .from(r)
      .where(and(eq(r.enrollmentId, enrollmentId), eq(r.nodeType, 'message')))
      .orderBy(desc(r.startedAt))
      .limit(1);
    return latest ?? null;
  }

  private async executeApproval(step: StepContext, node: Extract<JourneyNode, { type: 'approval' }>): Promise<Outcome> {
    const ctx = getCurrentContext();
    const a = schema.journeyApprovals;
    if (step.resumed) {
      if (step.resumed.resolution === 'approved') return { kind: 'advance', edge: 'next', to: node.next, reason: 'approved' };
      if (step.resumed.resolution === 'rejected') {
        return node.onReject
          ? { kind: 'advance', edge: 'on_reject', to: node.onReject, reason: 'rejected' }
          : { kind: 'exit', reason: 'approval_rejected' };
      }
      await ctx.db
        .update(a)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(a.stepRunId, step.stepRunId), eq(a.status, 'pending')));
      return node.onTimeout
        ? { kind: 'advance', edge: 'on_timeout', to: node.onTimeout, reason: 'approval timed out' }
        : { kind: 'exit', reason: 'approval_timeout' };
    }
    const expiresAt = new Date(step.now.getTime() + (parseIsoDurationMs(node.timeout) ?? 3 * 86_400_000));
    await ctx.db
      .insert(a)
      .values({
        orgId: step.enrollment.orgId,
        journeyId: step.enrollment.journeyId,
        enrollmentId: step.enrollment.id,
        stepRunId: step.stepRunId,
        nodeId: node.id,
        contactId: step.enrollment.contactId,
        title: node.title,
        instructions: node.instructions ?? null,
        expiresAt,
      })
      .onConflictDoNothing();
    const [approval] = await ctx.db.select({ id: a.id }).from(a).where(eq(a.stepRunId, step.stepRunId)).limit(1);
    await this.webhooks.emit({
      type: 'journey.approval.requested',
      payload: {
        approvalId: approval!.id,
        journeyId: step.enrollment.journeyId,
        enrollmentId: step.enrollment.id,
        nodeId: node.id,
        contactId: step.enrollment.contactId,
        title: node.title,
      },
      hopCount: step.hop,
    });
    return {
      kind: 'wait',
      wait: { kind: 'approval', match: { approvalId: approval!.id }, timeoutAt: expiresAt },
      output: { approvalId: approval!.id },
      reason: 'waiting for a person to approve',
    };
  }

  private async executeSubJourney(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'sub_journey' }>,
  ): Promise<Outcome> {
    const previous = await this.stepOutput(step.stepRunId);
    if (step.resumed) {
      const childId = typeof previous.childEnrollmentId === 'string' ? previous.childEnrollmentId : null;
      if (step.resumed.resolution === 'event' && childId) {
        const ctx = getCurrentContext();
        const [child] = await ctx.db
          .select({ goalReachedAt: schema.journeyEnrollments.goalReachedAt, exitReason: schema.journeyEnrollments.exitReason })
          .from(schema.journeyEnrollments)
          .where(eq(schema.journeyEnrollments.id, childId))
          .limit(1);
        if (child?.goalReachedAt && node.onGoal) {
          return { kind: 'advance', edge: 'on_goal', to: node.onGoal, output: previous, reason: 'the other journey reached its goal' };
        }
        return { kind: 'advance', edge: 'next', to: node.next, output: previous, reason: `the other journey ended: ${child?.exitReason ?? 'unknown'}` };
      }
      return { kind: 'advance', edge: 'next', to: node.next, output: previous, reason: 'the other journey did not end in time' };
    }
    const depth = (typeof step.enrollment.context.journeyDepth === 'number' ? step.enrollment.context.journeyDepth : 0) + 1;
    if (depth > MAX_SUB_JOURNEY_DEPTH) {
      return { kind: 'advance', edge: 'next', to: node.next, reason: `journeys nest at most ${MAX_SUB_JOURNEY_DEPTH} deep` };
    }
    if (node.journeyId === step.enrollment.journeyId) {
      return { kind: 'advance', edge: 'next', to: node.next, reason: 'a journey cannot enter itself' };
    }
    const result = await this.enroll({
      journeyId: node.journeyId,
      subject: { contactId: step.enrollment.contactId, endUserId: step.enrollment.endUserId },
      source: { type: 'journey', journeyId: step.enrollment.journeyId, enrollmentId: step.enrollment.id, nodeId: node.id },
      context: { journeyDepth: depth, parent: { journeyId: step.enrollment.journeyId, enrollmentId: step.enrollment.id } },
      hop: step.hop,
    }).catch((err: unknown): EnrollResult => ({ status: 'skipped', reason: err instanceof Error ? err.message : 'enroll_failed' }));
    const output = { childJourneyId: node.journeyId, childEnrollmentId: result.enrollmentId ?? null, childStatus: result.status };
    if (result.status !== 'enrolled' || !node.await) {
      return {
        kind: 'advance',
        edge: 'next',
        to: node.next,
        output,
        reason: result.status === 'enrolled' ? 'entered the other journey' : `did not enter the other journey: ${result.reason}`,
      };
    }
    return {
      kind: 'wait',
      wait: {
        kind: 'event',
        eventKey: 'journey.exited',
        match: { enrollmentId: result.enrollmentId! },
        timeoutAt: new Date(step.now.getTime() + (parseIsoDurationMs(node.timeout) ?? 30 * 86_400_000)),
      },
      output,
      reason: 'waiting for the other journey to end',
    };
  }

  async listApprovals(input: { status?: string; journeyId?: string; limit?: number } = {}) {
    const ctx = getCurrentContext();
    const a = schema.journeyApprovals;
    const filters = [eq(a.orgId, ctx.actor!.orgId)];
    if (input.status) filters.push(eq(a.status, input.status));
    if (input.journeyId) filters.push(eq(a.journeyId, input.journeyId));
    const rows = await ctx.db
      .select({
        id: a.id,
        journeyId: a.journeyId,
        journeyName: schema.journeys.name,
        enrollmentId: a.enrollmentId,
        nodeId: a.nodeId,
        contactId: a.contactId,
        contactName: schema.crmContacts.name,
        title: a.title,
        instructions: a.instructions,
        status: a.status,
        expiresAt: a.expiresAt,
        decidedByActorId: a.decidedByActorId,
        decidedAt: a.decidedAt,
        note: a.note,
        createdAt: a.createdAt,
      })
      .from(a)
      .innerJoin(schema.journeys, eq(schema.journeys.id, a.journeyId))
      .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, a.contactId))
      .where(and(...filters))
      .orderBy(desc(a.createdAt))
      .limit(Math.min(input.limit ?? 50, 200));
    return rows.map((r) => ({
      ...r,
      expiresAt: r.expiresAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async decideApproval(input: { approvalId: string; decision: 'approve' | 'reject'; note?: string }) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user') {
      throw new ForbiddenException('journeys_forbidden: approval steps are decided by a signed-in person in the Munin dashboard');
    }
    const a = schema.journeyApprovals;
    const [approval] = await ctx.db.select().from(a).where(and(eq(a.orgId, actor.orgId), eq(a.id, input.approvalId))).limit(1);
    if (!approval) throw new NotFoundException(`journeys_not_found: approval ${input.approvalId}`);
    if (approval.status !== 'pending') {
      throw new ConflictException(`journeys_conflict: approval ${input.approvalId} is already ${approval.status}`);
    }
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    const [decided] = await ctx.db
      .update(a)
      .set({ status, decidedByActorId: actor.id, decidedAt: new Date(), note: input.note ?? null, updatedAt: new Date() })
      .where(and(eq(a.id, approval.id), eq(a.status, 'pending')))
      .returning({ id: a.id });
    if (!decided) {
      throw new ConflictException(`journeys_conflict: approval ${input.approvalId} was decided or expired meanwhile`);
    }
    const w = schema.journeyWaits;
    const [wait] = await ctx.db
      .select()
      .from(w)
      .where(and(eq(w.kind, 'approval'), isNull(w.resolvedAt), sql`${w.match}->>'approvalId' = ${approval.id}`))
      .limit(1);
    if (wait) await this.resolveWait(wait, status);
    await this.webhooks.emit({
      type: 'journey.approval.decided',
      payload: { approvalId: approval.id, journeyId: approval.journeyId, enrollmentId: approval.enrollmentId, decision: status },
    });
    return { id: approval.id, status };
  }

  private async splitArrivals(step: StepContext, nodeId: string): Promise<number> {
    const ctx = getCurrentContext();
    const r = schema.journeyStepRuns;
    const e = schema.journeyEnrollments;
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .innerJoin(e, eq(e.id, r.enrollmentId))
      .where(
        and(
          eq(e.journeyId, step.enrollment.journeyId),
          eq(r.version, step.enrollment.version),
          eq(r.nodeId, nodeId),
          eq(r.status, 'completed'),
          sql`NOT (${r.output} ? 'sampleFull')`,
        ),
      );
    return row?.n ?? 0;
  }

  private async isSmsThread(enrollmentId: string, conversationId: string): Promise<boolean> {
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const [row] = await ctx.db
      .select({ id: p.id })
      .from(p)
      .where(and(eq(p.journeyEnrollmentId, enrollmentId), eq(p.conversationId, conversationId)))
      .limit(1);
    return Boolean(row);
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
    if (!wait) {
      await this.handleCompanyProposalEvent(row.orgId, proposalId, resolution);
      return;
    }
    if (
      resolution === 'proposal_sent' &&
      typeof row.payload.conversationId === 'string' &&
      row.payload.channel !== 'sms' &&
      row.payload.channel !== 'voice' &&
      row.payload.channel !== 'chat'
    ) {
      await this.rememberThread(wait.enrollmentId, row.payload.conversationId);
    }
    await this.resolveWait(wait, resolution);
  }

  private async handleCompanyProposalEvent(orgId: string, proposalId: string, resolution: string): Promise<void> {
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const [proposal] = await ctx.db
      .select({ stepRunId: p.journeyStepRunId })
      .from(p)
      .where(eq(p.id, proposalId))
      .limit(1);
    if (!proposal?.stepRunId) return;
    const w = schema.journeyWaits;
    const [wait] = await ctx.db
      .select()
      .from(w)
      .where(
        and(eq(w.orgId, orgId), eq(w.kind, 'proposal'), isNull(w.resolvedAt), sql`${w.match}->>'stepRunId' = ${proposal.stepRunId}`),
      )
      .limit(1);
    if (!wait) return;
    const [open] = await ctx.db
      .select({ id: p.id })
      .from(p)
      .where(and(eq(p.journeyStepRunId, proposal.stepRunId), inArray(p.status, ['pending', 'approved'])))
      .limit(1);
    if (!open) await this.resolveWait(wait, resolution);
  }

  private async handleReply(row: InboxRow, enrollments: EnrollmentRow[]): Promise<void> {
    const conversationId = row.payload.conversationId;
    if (typeof conversationId !== 'string' || row.payload.authorType !== 'end_user') return;
    if (row.payload.autoReply === true) return;
    const ctx = getCurrentContext();
    for (const enrollment of enrollments) {
      if (!isOpen(enrollment.state)) continue;
      if (enrollment.conversationId !== conversationId && !(await this.isSmsThread(enrollment.id, conversationId))) continue;
      const spec = await this.spec(enrollment.journeyId, enrollment.version);
      const lastMessage = await this.repliedStep(enrollment.id, conversationId);
      if (!lastMessage) continue;
      const node = spec.nodes.find((n) => n.id === lastMessage.nodeId);
      const reply = { conversationId, messageId: row.payload.messageId ?? null, eventId: row.eventId };
      if (node?.type === 'message' && node.onReply) {
        await this.cancelWaits(enrollment.id);
        await this.outreach.withdrawJourneyProposals(enrollment.id, 'the contact replied');
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
      await this.conv.requestHandover({
        conversationId,
        reason: 'the contact replied to a journey message; the journey waits until this conversation is closed',
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
      const base = await this.readDateField(step, node.untilField.field, timezone);
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
      const output = await this.inSavepoint(() => this.runAction(step, node));
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

  private async runCompanyAction(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'action' }>,
    companyId: string,
  ): Promise<Record<string, unknown>> {
    const params = node.params;
    switch (node.action) {
      case 'crm.add_tag':
      case 'crm.remove_tag': {
        const company = await this.crm.getCompany(companyId);
        const tag = String(params.tag);
        const tags =
          node.action === 'crm.add_tag' ? Array.from(new Set([...company.tags, tag])) : company.tags.filter((t) => t !== tag);
        if (tags.length !== company.tags.length) await this.crm.updateCompanyTags(companyId, tags);
        return { tag, tags };
      }
      case 'crm.log_activity': {
        const activity = await this.crm.logActivity({
          type: 'note',
          subject: String(params.subject),
          body: typeof params.body === 'string' ? params.body : undefined,
          companyId,
          metadata: { journeyId: step.enrollment.journeyId, nodeId: step.node.id },
        });
        return { activityId: activity.id };
      }
      case 'webhook.post':
        return this.runAction(step, node, true);
      default:
        throw new BadRequestException(`journeys_invalid: ${node.action} acts on a person and cannot run in a company journey`);
    }
  }

  private async runAction(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'action' }>,
    forCompany = false,
  ): Promise<Record<string, unknown>> {
    const ctx = getCurrentContext();
    const params = node.params;
    const contactId = step.enrollment.contactId;
    const companyId = step.enrollment.companyId;
    if (companyId && !contactId && !forCompany) return this.runCompanyAction(step, node, companyId);
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
              companyId: step.enrollment.companyId,
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
      .select({
        enrollment: e,
        name: schema.crmContacts.name,
        email: schema.crmContacts.email,
        companyName: schema.crmCompanies.name,
      })
      .from(e)
      .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, e.contactId))
      .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, e.companyId))
      .where(and(...filters))
      .orderBy(desc(e.enteredAt))
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
    return rows.map((r) => ({
      ...toEnrollmentDto(r.enrollment),
      contactName: r.name,
      contactEmail: r.email,
      companyName: r.companyName,
    }));
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
    const jobIds = steps
      .map((s) => s.output.curatorJobId)
      .filter((id): id is string => typeof id === 'string');
    const jobs = jobIds.length
      ? await ctx.db
          .select({
            id: schema.curatorJobs.id,
            status: schema.curatorJobs.status,
            totalTokens: schema.curatorJobs.lastTotalTokens,
          })
          .from(schema.curatorJobs)
          .where(inArray(schema.curatorJobs.id, jobIds))
      : [];
    const jobById = new Map(jobs.map((j) => [j.id, j]));
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
        agent:
          typeof s.output.curatorJobId === 'string' && jobById.has(s.output.curatorJobId)
            ? {
                jobId: s.output.curatorJobId,
                status: jobById.get(s.output.curatorJobId)!.status,
                totalTokens: jobById.get(s.output.curatorJobId)!.totalTokens,
                tier: 'fast' as const,
              }
            : null,
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

  async moveEnrollments(input: {
    journeyId: string;
    toVersion: number;
    nodeMap?: Record<string, string>;
    fromVersions?: number[];
    fingerprint?: string;
  }): Promise<MoveEnrollmentsResult> {
    const ctx = getCurrentContext();
    const [journey] = await ctx.db
      .select({ id: schema.journeys.id, status: schema.journeys.status })
      .from(schema.journeys)
      .where(and(eq(schema.journeys.orgId, ctx.actor!.orgId), eq(schema.journeys.id, input.journeyId)))
      .limit(1);
    if (!journey) throw new NotFoundException(`journeys_not_found: journey ${input.journeyId}`);
    const [target] = await ctx.db
      .select({ publishedAt: schema.journeyVersions.publishedAt })
      .from(schema.journeyVersions)
      .where(and(eq(schema.journeyVersions.journeyId, input.journeyId), eq(schema.journeyVersions.number, input.toVersion)))
      .limit(1);
    if (!target?.publishedAt) {
      throw new BadRequestException(`journeys_invalid: version ${input.toVersion} is not published; runs can only move to a published version`);
    }
    const toSpec = await this.spec(input.journeyId, input.toVersion);
    const toNodes = new Map(toSpec.nodes.map((n) => [n.id, n]));
    const e = schema.journeyEnrollments;
    const filters = [eq(e.journeyId, input.journeyId), inArray(e.state, ['active', 'waiting']), ne(e.version, input.toVersion)];
    if (input.fromVersions?.length) filters.push(inArray(e.version, input.fromVersions));
    const open = await ctx.db.select().from(e).where(and(...filters)).orderBy(asc(e.id));

    const byNode: MoveEnrollmentsResult['byNode'] = {};
    const skipped: MoveEnrollmentsResult['skipped'] = [];
    const plan: { enrollment: EnrollmentRow; to: string; resumes: boolean }[] = [];
    for (const enrollment of open) {
      const from = enrollment.currentNode;
      if (!from) continue;
      const fromSpec = await this.spec(input.journeyId, enrollment.version);
      const fromNode = fromSpec.nodes.find((n) => n.id === from);
      const to = input.nodeMap?.[from] ?? (toNodes.has(from) ? from : null);
      const toNode = to ? toNodes.get(to) : undefined;
      if (!to || !toNode) {
        skipped.push({ enrollmentId: enrollment.id, node: from, reason: to ? `node ${to} is not in version ${input.toVersion}` : 'no matching node; map it in nodeMap' });
        continue;
      }
      const resumes = to === from && toNode.type === fromNode?.type;
      if (!resumes && enrollment.state === 'waiting') {
        const [held] = await ctx.db
          .select({ kind: schema.journeyWaits.kind })
          .from(schema.journeyWaits)
          .where(
            and(
              eq(schema.journeyWaits.enrollmentId, enrollment.id),
              isNull(schema.journeyWaits.resolvedAt),
              inArray(schema.journeyWaits.kind, ['proposal', 'agent', 'approval']),
            ),
          )
          .limit(1);
        if (held) {
          skipped.push({ enrollmentId: enrollment.id, node: from, reason: `waiting on a ${held.kind} at ${from}; it can only stay on the same step` });
          continue;
        }
      }
      plan.push({ enrollment, to, resumes });
      const key = `v${enrollment.version}:${from}`;
      byNode[key] = { to, resumes, count: (byNode[key]?.count ?? 0) + 1 };
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([input.journeyId, input.toVersion, plan.map((p) => [p.enrollment.id, p.to])]), 'utf8')
      .digest('hex')
      .slice(0, 32);
    const result = { toVersion: input.toVersion, fingerprint, movable: plan.length, byNode, skipped, moved: 0, applied: false };
    if (!input.fingerprint) return result;
    if (input.fingerprint !== fingerprint) {
      throw new ConflictException('journeys_conflict: the runs to move changed since the preview; preview again and confirm the new fingerprint');
    }
    const now = new Date();
    let moved = 0;
    for (const { enrollment, to, resumes } of plan) {
      const [fresh] = await ctx.db.select().from(e).where(eq(e.id, enrollment.id)).limit(1).for('update');
      if (
        !fresh ||
        fresh.version !== enrollment.version ||
        fresh.currentNode !== enrollment.currentNode ||
        !['active', 'waiting'].includes(fresh.state)
      ) {
        skipped.push({ enrollmentId: enrollment.id, node: enrollment.currentNode ?? '', reason: 'it moved on while the runs were being moved' });
        continue;
      }
      enrollment.context = fresh.context;
      enrollment.visits = fresh.visits;
      const movedFrom = { version: enrollment.version, node: enrollment.currentNode, at: now.toISOString() };
      if (resumes) {
        await ctx.db
          .update(e)
          .set({ version: input.toVersion, context: { ...enrollment.context, movedFrom }, updatedAt: now })
          .where(eq(e.id, enrollment.id));
        moved += 1;
        continue;
      }
      await this.cancelWaits(enrollment.id);
      await ctx.db
        .update(schema.journeyStepRuns)
        .set({ status: 'completed', reason: `moved to v${input.toVersion}`, finishedAt: now })
        .where(
          and(
            eq(schema.journeyStepRuns.enrollmentId, enrollment.id),
            inArray(schema.journeyStepRuns.status, ['running', 'waiting', 'retrying']),
          ),
        );
      await ctx.db
        .update(e)
        .set({
          version: input.toVersion,
          state: 'active',
          currentNode: to,
          visits: { ...enrollment.visits, [to]: (enrollment.visits[to] ?? 0) + 1 },
          nextRunAt: now,
          context: { ...enrollment.context, movedFrom },
          updatedAt: now,
        })
        .where(eq(e.id, enrollment.id));
      moved += 1;
    }
    await this.webhooks.emit({
      type: 'journey.enrollments.moved',
      payload: { journeyId: input.journeyId, toVersion: input.toVersion, moved, skipped: skipped.length },
    });
    return { ...result, skipped, moved, applied: true };
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
    const companyId = typeof payload.companyId === 'string' ? payload.companyId : null;
    if (contactId || endUserId || companyId) return { contactId, endUserId, companyId };
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

  private async awaitChatSeen(
    step: StepContext,
    node: Extract<JourneyNode, { type: 'message' }>,
    previous: Record<string, unknown>,
    proposalId: unknown,
  ): Promise<Outcome> {
    const messageId = await this.proposalMessage(proposalId);
    if (!messageId) return { kind: 'advance', edge: 'next', to: node.next, output: { ...previous, proposalId }, reason: 'sent' };
    return {
      kind: 'wait',
      wait: {
        kind: 'event',
        eventKey: 'conversation.message.read',
        match: { messageId },
        timeoutAt: new Date(step.now.getTime() + (parseIsoDurationMs(node.seenTimeout ?? 'P3D') ?? 259_200_000)),
      },
      output: { ...previous, proposalId, messageId, awaitingSeen: true },
      reason: 'waiting for the chat message to be seen',
    };
  }

  private async proposalMessage(proposalId: unknown): Promise<string | null> {
    if (typeof proposalId !== 'string') return null;
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ messageId: schema.outreachProposals.sentMessageId })
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, proposalId))
      .limit(1);
    return row?.messageId ?? null;
  }

  private async proposalConversation(proposalId: unknown): Promise<string | null> {
    if (typeof proposalId !== 'string') return null;
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ conversationId: schema.outreachProposals.conversationId })
      .from(schema.outreachProposals)
      .where(eq(schema.outreachProposals.id, proposalId))
      .limit(1);
    return row?.conversationId ?? null;
  }

  private async pinnedTemplateHash(step: StepContext, nodeId: string): Promise<string | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ pinned: schema.journeyVersions.pinnedTemplates })
      .from(schema.journeyVersions)
      .where(and(eq(schema.journeyVersions.journeyId, step.enrollment.journeyId), eq(schema.journeyVersions.number, step.enrollment.version)))
      .limit(1);
    return row?.pinned[nodeId] ?? null;
  }

  private inSavepoint<T>(fn: () => Promise<T>): Promise<T> {
    const ctx = getCurrentContext();
    return ctx.db.transaction((tx) => withContext({ ...ctx, db: tx }, fn));
  }

  private async assertSubjectExists(subject: Subject): Promise<void> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    if (subject.contactId) {
      const [row] = await ctx.db
        .select({ id: schema.crmContacts.id })
        .from(schema.crmContacts)
        .where(and(eq(schema.crmContacts.orgId, orgId), eq(schema.crmContacts.id, subject.contactId)))
        .limit(1);
      if (!row) throw new NotFoundException(`journeys_not_found: contact ${subject.contactId}`);
    }
    if (subject.endUserId) {
      const [row] = await ctx.db
        .select({ id: schema.endUsers.id })
        .from(schema.endUsers)
        .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.id, subject.endUserId)))
        .limit(1);
      if (!row) throw new NotFoundException(`journeys_not_found: end user ${subject.endUserId}`);
    }
  }

  private async subjectCompany(subject: Subject): Promise<string | null> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    if (subject.companyId) {
      const [row] = await ctx.db
        .select({ id: schema.crmCompanies.id })
        .from(schema.crmCompanies)
        .where(and(eq(schema.crmCompanies.orgId, orgId), eq(schema.crmCompanies.id, subject.companyId)))
        .limit(1);
      if (!row) throw new NotFoundException(`journeys_not_found: company ${subject.companyId}`);
      return row.id;
    }
    const person = await this.completeSubject(subject);
    if (!person.contactId) return null;
    const [contact] = await ctx.db
      .select({ companyId: schema.crmContacts.companyId })
      .from(schema.crmContacts)
      .where(eq(schema.crmContacts.id, person.contactId))
      .limit(1);
    return contact?.companyId ?? null;
  }

  async companyInSegment(companyId: string, segmentId: string): Promise<boolean> {
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
      .where(and(eq(schema.crmContacts.companyId, companyId), ...OUTREACH_ELIGIBILITY_FLOOR, ...segmentMatchFilters(segment.filter)))
      .limit(1);
    return Boolean(row);
  }

  async segmentCompanies(
    segmentId: string,
    limit: number,
    exclude?: { journeyId: string; reentry: string; since: Date | null },
  ): Promise<string[]> {
    const ctx = getCurrentContext();
    const [segment] = await ctx.db
      .select({ filter: schema.crmSegments.filterDefinition })
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, segmentId))
      .limit(1);
    if (!segment) return [];
    const c = schema.crmContacts;
    const rows = await ctx.db
      .select({ companyId: c.companyId })
      .from(c)
      .where(
        and(
          eq(c.orgId, ctx.actor!.orgId),
          isNotNull(c.companyId),
          ...OUTREACH_ELIGIBILITY_FLOOR,
          ...segmentMatchFilters(segment.filter),
          ...(exclude ? [sql`NOT EXISTS (
            SELECT 1 FROM journey_enrollments en
             WHERE en.journey_id = ${exclude.journeyId}
               AND en.subject_key = 'co:' || ${c.companyId}
               AND (
                 ${exclude.reentry === 'once'}
                 OR en.state IN ('active', 'waiting')
                 OR en.entered_at >= ${(exclude.since ?? new Date(0)).toISOString()}::timestamptz
               )
          )`] : []),
        ),
      )
      .groupBy(c.companyId)
      .orderBy(sql`min(${c.createdAt})`)
      .limit(limit);
    return rows.map((r) => r.companyId!).filter(Boolean);
  }

  private async completeSubject(subject: Subject): Promise<Subject> {
    const ctx = getCurrentContext();
    const c = schema.crmContacts;
    if (subject.contactId && !subject.endUserId) {
      const [row] = await ctx.db.select({ endUserId: c.endUserId }).from(c).where(eq(c.id, subject.contactId)).limit(1);
      return { ...subject, endUserId: row?.endUserId ?? null };
    }
    if (!subject.contactId && subject.endUserId) {
      const [row] = await ctx.db
        .select({ id: c.id })
        .from(c)
        .where(and(eq(c.orgId, ctx.actor!.orgId), eq(c.endUserId, subject.endUserId)))
        .orderBy(asc(c.createdAt))
        .limit(1);
      return { ...subject, contactId: row?.id ?? null };
    }
    return subject;
  }

  private async subjectEnrollments(subject: Subject, payload: Record<string, unknown>): Promise<EnrollmentRow[]> {
    const ctx = getCurrentContext();
    const e = schema.journeyEnrollments;
    const matches: SQL[] = [];
    if (subject.contactId) matches.push(eq(e.contactId, subject.contactId));
    if (subject.endUserId) matches.push(eq(e.endUserId, subject.endUserId));
    if (subject.companyId) matches.push(eq(e.companyId, subject.companyId));
    if (subject.contactId) {
      matches.push(sql`${e.companyId} = (SELECT company_id FROM crm_contacts WHERE id = ${subject.contactId})`);
    }
    if (typeof payload.conversationId === 'string') {
      matches.push(eq(e.conversationId, payload.conversationId));
      matches.push(
        sql`EXISTS (SELECT 1 FROM ${schema.outreachProposals} p WHERE p.journey_enrollment_id = ${e.id} AND p.conversation_id = ${payload.conversationId})`,
      );
    }
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

  async segmentContacts(
    segmentId: string,
    limit: number,
    exclude?: { journeyId: string; reentry: string; since: Date | null },
  ): Promise<string[]> {
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
          ...(exclude ? [sql`NOT EXISTS (
            SELECT 1 FROM journey_enrollments en
             WHERE en.journey_id = ${exclude.journeyId}
               AND en.subject_key = 'c:' || ${schema.crmContacts.id}
               AND (
                 ${exclude.reentry === 'once'}
                 OR en.state IN ('active', 'waiting')
                 OR en.entered_at >= ${(exclude.since ?? new Date(0)).toISOString()}::timestamptz
               )
          )`] : []),
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
        companyId: step.enrollment.companyId,
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
      companyId?: string | null;
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
    const companyId = enrollment.companyId ?? contact?.companyId ?? null;
    const company = companyId
      ? ((await ctx.db.select().from(schema.crmCompanies).where(eq(schema.crmCompanies.id, companyId)).limit(1))[0] ?? null)
      : null;
    const wholeCompany = !enrollment.contactId && !enrollment.endUserId && !!enrollment.companyId;

    let events: { name: string; occurredAt: Date }[] = [];
    if (needs.eventNames.size > 0 && (enrollment.contactId || enrollment.endUserId || wholeCompany)) {
      const pe = schema.analyticsProductEvents;
      const who: SQL[] = [];
      if (enrollment.contactId) who.push(eq(pe.contactId, enrollment.contactId));
      if (enrollment.endUserId) who.push(eq(pe.endUserId, enrollment.endUserId));
      if (wholeCompany) {
        who.push(sql`${pe.contactId} IN (SELECT id FROM crm_contacts WHERE company_id = ${enrollment.companyId})`);
      }
      events = await ctx.db
        .select({ name: pe.name, occurredAt: pe.occurredAt })
        .from(pe)
        .where(and(eq(pe.orgId, ctx.actor!.orgId), inArray(pe.name, [...needs.eventNames]), or(...who)));
    }

    const segments = new Set<string>();
    for (const segmentId of needs.segmentIds) {
      const member = enrollment.contactId
        ? await this.contactInSegment(enrollment.contactId, segmentId)
        : wholeCompany
          ? await this.companyInSegment(enrollment.companyId!, segmentId)
          : false;
      if (member) segments.add(segmentId);
    }

    return {
      contact: contact as Record<string, unknown> | null,
      company: company as Record<string, unknown> | null,
      tags: contact?.tags ?? (wholeCompany ? (company?.tags ?? []) : []),
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

  private async readDateField(step: StepContext, field: string, timezone: string): Promise<Date | null> {
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
    return parseZonedDate(value, timezone);
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
        version: enrollment.version,
        visit,
        status: 'running',
        input,
        startedAt: sql`clock_timestamp()`,
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
    await ctx.db.execute(sql`SELECT id FROM journey_enrollments WHERE id = ${wait.enrollmentId} FOR UPDATE`);
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
      .where(and(eq(e.id, enrollment.id), eq(e.state, 'waiting')));
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
    await this.outreach.withdrawJourneyProposals(enrollment.id, `the journey run ended (${reason})`);
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
  if (subject.companyId && !subject.contactId && !subject.endUserId) return `co:${subject.companyId}`;
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

const DRAFT_LIMITS: Record<Extract<JourneyNode, { type: 'message' }>['channel'], number> = {
  email: 20_000,
  sms: JOURNEY_SMS_MAX_CHARS,
  chat: JOURNEY_CHAT_MAX_CHARS,
  voice: JOURNEY_CALL_OPENING_MAX_CHARS,
};

function edgeTarget(node: JourneyNode, edge: string): string | undefined {
  switch (node.type) {
    case 'message':
      if (edge.startsWith('outcome_')) {
        return node.onOutcome?.[edge.slice('outcome_'.length) as keyof NonNullable<typeof node.onOutcome>] ?? node.next;
      }
      if (edge === 'on_unseen') return node.onUnseen ?? node.next;
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
    case 'approval':
      return edge === 'on_reject' ? node.onReject : edge === 'on_timeout' ? node.onTimeout : node.next;
    case 'sub_journey':
      return edge === 'on_goal' ? node.onGoal : node.next;
    case 'action':
    case 'wait':
    case 'goal':
      return node.next;
    default:
      return undefined;
  }
}

export function nextScheduledEntry(
  trigger: Extract<JourneySpec['entry']['trigger'], { type: 'segment' }>,
  now: Date,
  fallbackTimezone?: string,
): Date | null {
  if (trigger.schedule === 'once') return null;
  return nextLocalOccurrence(now, trigger.at, trigger.timezone ?? fallbackTimezone ?? 'UTC', trigger.schedule === 'weekly' ? (trigger.weekday ?? 'mon') : null);
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
    companyId: row.companyId,
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

function coerceField(
  field: { type: string; options?: string[] },
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) return null;
  switch (field.type) {
    case 'string':
      return typeof value === 'string' && value.length <= 500 ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
    case 'enum':
      return typeof value === 'string' && (field.options ?? []).includes(value) ? value : undefined;
    default:
      return undefined;
  }
}

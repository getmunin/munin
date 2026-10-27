import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import {
  JOURNEY_ACTIONS,
  JOURNEY_NODE_TYPES,
  JourneyNodeSchema,
} from '@getmunin/types';
import { JOURNEY_STATUSES, JourneysService } from './journeys.service.ts';
import { ENROLLMENT_STATES, JourneyRuntimeService, type EnrollmentState } from './journey-runtime.service.ts';
import { JourneyPublishingService } from './journey-publishing.service.ts';
import { JourneyTemplatesService } from './journey-templates.service.ts';
import { JourneyMonitorService } from './journey-monitor.service.ts';

const Id = z.string().min(1).max(64);
const NodeIdInput = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const NodeInput = z
  .looseObject({ id: NodeIdInput, type: z.enum(JOURNEY_NODE_TYPES) })
  .describe('One node, shaped as listed by journeys_list_node_types.');
const SpecInput = z
  .record(z.string(), z.unknown())
  .describe('Whole journey spec: { entry, exit, goal, settings, start, nodes }.');

const NODE_TYPE_REFERENCE = [
  {
    type: 'message',
    does: 'Send the contact an email, an SMS, a chat message in the widget or a phone call. approval: draft_only (default, filed for human review), auto (email and chat only: sends without review once a person publishes the version) or off (skipped). SMS and calls are always approved by a person.',
    fields: '{ channel: "email"|"sms"|"chat"|"voice", class?: "marketing"|"transactional", content: { subject (email only), body, format?: "markdown"|"mjml", preheader?, templateId? }, approval?, next?, onReply?, onOutcome? (voice: reached, no_contact, refused, wrong_contact, timeout), outcomeTimeout?, onUnseen? + seenTimeout? (chat), recipients?: { tag?, titleContains?, max? } (company journeys only), draftBy?: "agent", brief?, grounding?: [kb space slugs], locale?, draftInputs?, draftTimeout?: "PT30M" } — sms needs settings.smsChannelId (body ≤ 480), chat settings.chatChannelId (body ≤ 2000, signed-in widget visitors only), voice settings.voiceChannelId (body is the opening, ≤ 1000); with draftBy "agent" a model rewrites the message for each person from the brief (content is the reference version and the fallback)',
  },
  {
    type: 'action',
    does: `Run one deterministic action: ${JOURNEY_ACTIONS.join(', ')}.`,
    fields: '{ action, params, onFail?: "proceed"|"exit", retry?: "default"|"none", next? } — params: crm.add_tag/remove_tag { tag }, crm.update_contact { fields }, crm.log_activity { subject, body? }, webhook.post { webhookId }',
  },
  {
    type: 'wait',
    does: 'Pause for a duration, until a date, or until a date field ± offset; optionally only release on valid days and hours.',
    fields: '{ duration?: "P5D", until?: ISO datetime, untilField?: { field, offset? }, validDays?, validHours?: "09:00-17:00", next? } — exactly one of duration, until, untilField',
  },
  {
    type: 'wait_for',
    does: 'Hold until an event for this contact arrives (product event name or catalog event such as conversation.status_changed), or until the timeout.',
    fields: '{ event, where?: { payloadKey: value }, timeout: "P14D", next?, onTimeout? }',
  },
  {
    type: 'branch',
    does: 'Take the first rule whose condition holds, otherwise default. Conditions: { all|any: [...] }, { not }, { field: "contact.title"|"contact.custom_fields.plan"|"company.name", op, value }, { context, op, value }, { tag, present? }, { event, occurred?, since?: "entry"|{ days }, minCount? }, { segment, member? }, { time: { days?, between? } }.',
    fields: '{ rules: [{ if, next }], default }',
  },
  {
    type: 'split',
    does: 'Send contacts down weighted paths by a stable hash of the contact; percentages add up to 100.',
    fields: '{ paths: [{ name, percent, next }] }',
  },
  {
    type: 'goal',
    does: 'Record a conversion checkpoint; optionally exit when reached.',
    fields: '{ name, exitOnReach?, next? }',
  },
  { type: 'jump', does: 'Loop back to another node; each node has a per-contact visit cap.', fields: '{ to }' },
  { type: 'exit', does: 'End the run with a reason code.', fields: '{ reason?: "reached_end" }' },
  {
    type: 'agent',
    does: 'decide: a model reads only the declared inputs about this person (national ID numbers removed) and picks one declared edge, logging its reason. If it has not answered within the timeout — or no model is configured — the run takes the fallback edge. An edge named "stop" also ends every other journey the person is in (reason conversation_stop). For a reply intent step, put it behind a message onReply with inputs ["reply", "thread", "contact"], edges interested / question / not_now / stop, and fallback question.',
    fields: 'decide: { mode: "decide", instructions, edges: { name: nodeId, … } (2–10), fallback: one edge name, inputs: ["contact"|"company"|"reply"|"thread"|"events"|"context"], timeout?: "PT10M" } · enrich: { mode: "enrich", instructions, fields: [{ key, type: "string"|"number"|"boolean"|"date"|"enum", description, options? }], inputs, next, timeout? } — enrich writes the fields to the contact and to context.enriched',
  },
  {
    type: 'approval',
    does: 'Hold the run until a signed-in person approves or rejects it in the Munin dashboard. Agents and API keys cannot decide it.',
    fields: '{ title, instructions?, timeout?: "P3D", next (approved), onReject?, onTimeout? } — without onReject or onTimeout the run exits with approval_rejected or approval_timeout',
  },
  {
    type: 'sub_journey',
    does: 'Enter the person into another live journey. With await: true the run waits until that journey ends and continues on onGoal when it reached its goal, otherwise on next. Journeys may not call each other in a loop, and nesting stops at 3 levels.',
    fields: '{ journeyId, await?: false, timeout?: "P30D", next?, onGoal? }',
  },
];

const JourneyIdInput = z.object({ journeyId: Id });

@Injectable()
export class JourneysTools {
  constructor(
    @Inject(JourneysService) private readonly journeys: JourneysService,
    @Inject(JourneyRuntimeService) private readonly runtime: JourneyRuntimeService,
    @Inject(JourneyPublishingService) private readonly publishing: JourneyPublishingService,
    @Inject(JourneyTemplatesService) private readonly templates: JourneyTemplatesService,
    @Inject(JourneyMonitorService) private readonly monitor: JourneyMonitorService,
  ) {}

  @McpTool({
    name: 'journeys_list_templates',
    title: 'Journeys: List templates',
    description:
      'Starter journey templates (inbound lead, trial onboarding, webinar, win-back, satisfaction after a conversation, sunset unengaged — each in nb, sv and en) and the org\'s own saved templates, with the parameters each needs. Filter by locale.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: z.object({ locale: z.string().min(2).max(10).optional() }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  listTemplates(args: { locale?: string }) {
    return this.templates.list(args.locale);
  }

  @McpTool({
    name: 'journeys_get_template',
    title: 'Journeys: Get a template',
    description: 'One template with its full spec, so you can adapt it before instantiating.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: z.object({ slug: z.string().min(1).max(64), locale: z.string().min(2).max(10) }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  getTemplate(args: { slug: string; locale: string }) {
    return this.templates.get(args.slug, args.locale);
  }

  @McpTool({
    name: 'journeys_instantiate_template',
    title: 'Journeys: Create a journey from a template',
    description:
      'Create a draft journey on an email outreach campaign from a template, filling its parameters (for example segmentId). Returns the journey and its validation result; edit the draft afterwards like any other.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({
      slug: z.string().min(1).max(64),
      locale: z.string().min(2).max(10),
      name: z.string().min(1).max(120),
      outreachCampaignId: Id,
      params: z.record(z.string(), z.string().max(200)).default({}),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  instantiateTemplate(args: { slug: string; locale: string; name: string; outreachCampaignId: string; params: Record<string, string> }) {
    return this.templates.instantiate(args);
  }

  @McpTool({
    name: 'journeys_create_from_campaign',
    title: 'Journeys: Create a journey from a campaign sequence',
    description:
      'Convert an email outreach campaign\'s first touch and sequence steps into a draft journey: an agent-drafted email per step, a wait between them, and a reply ends the sequence. Give the goal event that counts as success. From then on the campaign\'s own first touches and follow-ups stop, because the journey runs it; archive the journey to hand them back.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({
      campaignId: Id,
      name: z.string().min(1).max(120).optional(),
      goal: z.object({ event: z.string().min(1).max(96), windowDays: z.number().int().min(1).max(365) }),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  createFromCampaign(args: { campaignId: string; name?: string; goal: { event: string; windowDays: number } }) {
    return this.templates.createFromCampaign(args);
  }

  @McpTool({
    name: 'journeys_get_agent_stats',
    title: 'Journeys: Get agent step stats',
    description:
      'How each agent step performed over the last N days (default 30): runs, how often it fell back, tokens used, the edges a decide step chose per day, and for agent-drafted messages how often reviewers edited or rejected the draft. Use it to tune briefs, edges and timeouts.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput.extend({ days: z.number().int().min(1).max(90).default(30) }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  getAgentStats(args: { journeyId: string; days: number }) {
    return this.publishing.agentStats(args.journeyId, args.days);
  }

  @McpTool({
    name: 'journeys_save_as_template',
    title: 'Journeys: Save a journey as a template',
    description:
      'Save a journey version (live by default) as an org template. Use replace to turn concrete values into parameters, for example { "<segment id>": "segmentId" }, and declare each parameter in params. Saving the same slug and locale again replaces it.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      version: z.number().int().min(1).optional(),
      slug: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      locale: z.string().min(2).max(10),
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(1000),
      tags: z.array(z.string().min(1).max(32)).max(10).optional(),
      params: z
        .array(z.object({ key: z.string().regex(/^[a-zA-Z0-9_]+$/), description: z.string().max(300), required: z.boolean() }))
        .max(10)
        .optional(),
      replace: z.record(z.string().min(1).max(200), z.string().regex(/^[a-zA-Z0-9_]+$/)).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  saveAsTemplate(args: {
    journeyId: string;
    version?: number;
    slug: string;
    locale: string;
    title: string;
    description: string;
    tags?: string[];
    params?: { key: string; description: string; required: boolean }[];
    replace?: Record<string, string>;
  }) {
    return this.templates.saveAsTemplate(args);
  }

  @McpTool({
    name: 'journeys_simulate',
    title: 'Journeys: Simulate a version',
    description:
      'Dry-run a journey version (the open draft by default) over sample contacts — given ids, a segment, the entry segment, or the most recently updated contacts — without writing or sending anything. Returns who would enter or be excluded and why, arrivals per node, edges taken, exits by reason, the send decision for each email (send, defer or skip with the reason) and rendered samples, plus the assumptions the dry run made (waits elapse, awaited events do not arrive, reviewers approve).',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput.extend({
      version: z.number().int().min(1).optional(),
      contactIds: z.array(Id).max(500).optional(),
      segmentId: Id.optional(),
      limit: z.number().int().min(1).max(500).optional(),
      renderSamples: z.number().int().min(0).max(5).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  simulate(args: {
    journeyId: string;
    version?: number;
    contactIds?: string[];
    segmentId?: string;
    limit?: number;
    renderSamples?: number;
  }) {
    return this.publishing.simulate(args);
  }

  @McpTool({
    name: 'journeys_request_publish',
    title: 'Journeys: Request publish of a draft',
    description:
      'Ask for a draft version to go live. The draft must validate without errors. Returns the diff against the live version (with the emails that would send without review), the validation result, a simulation and the dashboard path where a signed-in person confirms it. Nothing goes live until that person confirms; editing the draft afterwards cancels the request.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ version: z.number().int().min(1).optional() }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestPublish(args: { journeyId: string; version?: number }) {
    return this.publishing.requestPublish(args.journeyId, args.version);
  }

  @McpTool({
    name: 'journeys_get_node_review_stats',
    title: 'Journeys: Get email review stats per step',
    description:
      'How reviewers treated each email step of a journey over the last 30 days: approved unedited, edited, dismissed, still pending and sent without review, the unedited share, and whether the step has earned sending without review (30 reviewed drafts at 90% or more approved unedited). Only a person can then publish a version with that step set to auto.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getNodeReviewStats(args: z.infer<typeof JourneyIdInput>) {
    return this.publishing.nodeReviewStats(args.journeyId);
  }

  @McpTool({
    name: 'journeys_get_report',
    title: 'Journeys: Get a journey report',
    description:
      'Results for a journey (the live version by default, or one version): enrollments by state and exit reason, goal conversion for the treated group against the holdout and the difference between them, arrivals, waiting counts and edge distribution per node, and the outcome of each email step, plus run integrity: steps that sent more than one email and people with no logged step (both should stay at zero).',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput.extend({ version: z.number().int().min(1).optional() }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  getReport(args: { journeyId: string; version?: number }) {
    return this.publishing.report(args.journeyId, args.version);
  }

  @McpTool({
    name: 'journeys_submit_decision',
    title: 'Journeys: Submit an agent step decision',
    description:
      'Answer a waiting agent decide step in a live journey: choose one of the step\'s declared edges for that person, with a short reason a reviewer can check. Used by the curator pass skill://journeys/decide-step; refused once the step was decided or has timed out to its fallback edge.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({
      stepRunId: Id,
      edge: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
      reason: z.string().min(1).max(500),
      confidence: z.enum(['high', 'medium', 'low']).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  submitDecision(args: { stepRunId: string; edge: string; reason: string; confidence?: 'high' | 'medium' | 'low' }) {
    return this.runtime.submitDecision(args);
  }

  @McpTool({
    name: 'journeys_submit_draft',
    title: 'Journeys: Submit an agent message draft',
    description:
      'Answer a waiting agent-drafted message step: the text written for this person, with the knowledge-base sources each factual claim rests on. An email takes a subject and markdown body; an SMS, chat message or call opening takes only the body, within that channel\'s length limit. The draft goes to the review inbox like any journey message. Used by the curator pass skill://journeys/draft-step; refused once the step was answered or timed out to the reference version.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({
      stepRunId: Id,
      subject: z.string().min(1).max(300).optional(),
      body: z.string().min(1).max(20_000),
      citations: z
        .array(z.object({ title: z.string().min(1).max(200), source: z.string().min(1).max(500) }))
        .max(20)
        .optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  submitDraft(args: { stepRunId: string; subject?: string; body: string; citations?: { title: string; source: string }[] }) {
    return this.runtime.submitDraft(args);
  }

  @McpTool({
    name: 'journeys_submit_fields',
    title: 'Journeys: Submit agent-filled fields',
    description:
      'Answer a waiting agent enrich step: values for the step\'s declared fields, written to the contact\'s custom fields and the journey context so later branches can use them. Leave out fields the facts do not support. Used by the curator pass skill://journeys/enrich-step.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({ stepRunId: Id, fields: z.record(z.string(), z.unknown()) }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  submitFields(args: { stepRunId: string; fields: Record<string, unknown> }) {
    return this.runtime.submitFields(args);
  }

  @McpTool({
    name: 'journeys_list_enrollments',
    title: 'Journeys: List enrollments',
    description:
      'List the people in a journey, newest first: which version they entered, where they are now, whether they are in the holdout, and why they left if they did. Filter by state or contact.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput.extend({
      state: z.enum(ENROLLMENT_STATES).optional(),
      contactId: Id.optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  listEnrollments(args: { journeyId: string; state?: EnrollmentState; contactId?: string; limit?: number }) {
    return this.runtime.listEnrollments(args);
  }

  @McpTool({
    name: 'journeys_get_trace',
    title: 'Journeys: Get an enrollment trace',
    description:
      'The full step log for one person in one journey: every node visited, the edge taken and why, action results, retries, and what the run is waiting for now.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: z.object({ enrollmentId: Id }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  getTrace(args: { enrollmentId: string }) {
    return this.runtime.getTrace(args.enrollmentId);
  }

  @McpTool({
    name: 'journeys_enroll',
    title: 'Journeys: Enroll a person or company',
    description:
      'Put one contact, end user or company into a live journey now, as if its trigger fired. A company journey (entry.subject "company") takes a companyId, or a contact whose company it then follows. The entry segment, re-entry policy and holdout still apply; the result says whether they entered and, if not, why.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      contactId: Id.optional(),
      endUserId: Id.optional(),
      companyId: Id.optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  enroll(args: {
    journeyId: string;
    contactId?: string;
    endUserId?: string;
    companyId?: string;
    context?: Record<string, unknown>;
  }) {
    if (!args.contactId && !args.endUserId && !args.companyId) {
      throw new BadRequestException('journeys_invalid: pass contactId, endUserId or companyId');
    }
    return this.runtime.enroll({
      journeyId: args.journeyId,
      subject: { contactId: args.contactId ?? null, endUserId: args.endUserId ?? null, companyId: args.companyId ?? null },
      source: { type: 'manual' },
      context: args.context,
    });
  }

  @McpTool({
    name: 'journeys_eject',
    title: 'Journeys: Eject a person from a journey',
    description: 'End one person\'s run in a journey now. Their open waits are cancelled and the exit is logged with the reason.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({
      enrollmentId: Id,
      reason: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  eject(args: { enrollmentId: string; reason?: string }) {
    return this.runtime.eject(args.enrollmentId, args.reason ?? 'ejected');
  }

  @McpTool({
    name: 'journeys_list_node_types',
    title: 'Journeys: List node types',
    description:
      'Reference for the journey spec: every node type with what it does and its fields, plus the entry, exit, goal and settings blocks. Read it before drafting or editing a journey.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: z.object({}),
    readOnlyHint: true,
    destructiveHint: false,
  })
  listNodeTypes() {
    return {
      nodes: NODE_TYPE_REFERENCE,
      spec: {
        entry:
          '{ trigger: { type: "event", event, where? } | { type: "segment", segmentId, schedule: "once"|"daily"|"weekly", at?: "09:00", weekday?, timezone? } | { type: "manual" }, segmentId?, reentry?: "once"|"once_at_a_time"|"concurrent", lateEventWindowHours?, lastEntryAt? }',
        exit: '{ idleDays?, on?: [{ event, where? }] }',
        goal: '{ event, where?, windowDays, exitOnGoal? } — required before publishing',
        settings:
          '{ timezone?, quietHours?: "20:00-08:00", validDays?, holdoutPct?, frequencyCapPerWeek?, cooldownHoursAfterConversation?, maxVisitsPerNode? }',
        start: 'id of the first node',
      },
    };
  }

  @McpTool({
    name: 'journeys_list',
    title: 'Journeys: List journeys',
    description: 'List journeys with their status, live version and open draft version. Archived journeys are left out unless status is "archived".',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: z.object({
      status: z.enum(JOURNEY_STATUSES).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  list(args: { status?: (typeof JOURNEY_STATUSES)[number]; limit?: number }) {
    return this.journeys.list(args);
  }

  @McpTool({
    name: 'journeys_get',
    title: 'Journeys: Get a journey',
    description: 'Get one journey with the spec of its open draft version and of its live version.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  get(args: z.infer<typeof JourneyIdInput>) {
    return this.journeys.get(args.journeyId);
  }

  @McpTool({
    name: 'journeys_list_versions',
    title: 'Journeys: List versions',
    description: 'List every version of a journey, newest first, with its change summary, validation result and publish state.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listVersions(args: z.infer<typeof JourneyIdInput>) {
    return this.journeys.listVersions(args.journeyId);
  }

  @McpTool({
    name: 'journeys_validate',
    title: 'Journeys: Validate a version',
    description:
      'Check a journey version (the open draft by default) for schema errors, missing or unreachable nodes, dangling edges, loops without a wait, unknown segments, templates or webhooks, and a missing goal. Errors block publishing; warnings do not.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ version: z.number().int().min(1).optional() }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  validate(args: { journeyId: string; version?: number }) {
    return this.journeys.validate(args.journeyId, args.version);
  }

  @McpTool({
    name: 'journeys_create',
    title: 'Journeys: Create a journey',
    description:
      'Create a journey on an existing email outreach campaign (one journey per campaign). The campaign keeps the sending channel, brief, cadence rules and extraction schema. Starts draft version 1 from `spec`, or from an empty spec when omitted.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(1000).optional(),
      outreachCampaignId: Id,
      spec: SpecInput.optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  create(args: { name: string; description?: string; outreachCampaignId: string; spec?: Record<string, unknown> }) {
    return this.journeys.create(args);
  }

  @McpTool({
    name: 'journeys_replace_draft',
    title: 'Journeys: Replace the draft spec',
    description:
      'Replace the whole spec of the journey\'s open draft version, creating a new draft from the live version first when none is open. Published versions never change.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ spec: SpecInput, changeSummary: z.string().max(300).optional() }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  replaceDraft(args: { journeyId: string; spec: Record<string, unknown>; changeSummary?: string }) {
    return this.journeys.replaceDraft(args.journeyId, args.spec, args.changeSummary);
  }

  @McpTool({
    name: 'journeys_add_node',
    title: 'Journeys: Add a node to the draft',
    description:
      'Add one node to the open draft. With `after`, also points that node\'s edge (default `next`) at the new node.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      node: NodeInput,
      after: z.object({ nodeId: NodeIdInput, edge: z.enum(['next', 'onReply', 'onTimeout', 'default']).optional() }).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  addNode(args: { journeyId: string; node: Record<string, unknown> & { id: string }; after?: { nodeId: string; edge?: string } }) {
    assertNodeShape(args.node);
    return this.journeys.addNode(args.journeyId, args.node, args.after);
  }

  @McpTool({
    name: 'journeys_update_node',
    title: 'Journeys: Update a node in the draft',
    description: 'Replace the node with the same id in the open draft, including its edges.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ node: NodeInput }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateNode(args: { journeyId: string; node: Record<string, unknown> & { id: string } }) {
    assertNodeShape(args.node);
    return this.journeys.updateNode(args.journeyId, args.node);
  }

  @McpTool({
    name: 'journeys_remove_node',
    title: 'Journeys: Remove a node from the draft',
    description: 'Remove a node from the open draft. Edges that pointed at it are left for you to rewire; journeys_validate lists them.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ nodeId: NodeIdInput }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  removeNode(args: { journeyId: string; nodeId: string }) {
    return this.journeys.removeNode(args.journeyId, args.nodeId);
  }

  @McpTool({
    name: 'journeys_update_settings',
    title: 'Journeys: Update entry, exit, goal or settings',
    description:
      'Replace any of the draft\'s start node, entry block, exit block, goal or settings block. Fields left out are kept.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      start: NodeIdInput.optional(),
      entry: z.record(z.string(), z.unknown()).optional(),
      exit: z.record(z.string(), z.unknown()).optional(),
      goal: z.record(z.string(), z.unknown()).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateSettings(args: {
    journeyId: string;
    start?: string;
    entry?: Record<string, unknown>;
    exit?: Record<string, unknown>;
    goal?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  }) {
    const { journeyId, ...patch } = args;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('journeys_invalid: pass at least one of start, entry, exit, goal, settings');
    }
    return this.journeys.updateSettings(journeyId, patch);
  }

  @McpTool({
    name: 'journeys_restore_version',
    title: 'Journeys: Restore a version as the draft',
    description: 'Copy an earlier version\'s spec into the open draft. It goes live only after it is published again.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ version: z.number().int().min(1) }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  restoreVersion(args: { journeyId: string; version: number }) {
    return this.journeys.restoreVersion(args.journeyId, args.version);
  }

  @McpTool({
    name: 'journeys_move_enrollments',
    title: 'Journeys: Move enrollments to another version',
    description:
      'Move open runs from older versions onto a published version. Each run continues at the node with the same id, or where nodeMap sends it ({ "old_node": "new_node" }). Call it first without fingerprint for a preview — how many runs move from which node, and which are skipped and why — then again with the preview fingerprint to move them. A run that stays on the same step keeps its wait; one that moves to another step starts that step fresh. Runs waiting on a proposal, an agent or an approval only move when they stay on the same step.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      toVersion: z.number().int().min(1),
      nodeMap: z.record(z.string().min(1).max(48), z.string().min(1).max(48)).optional(),
      fromVersions: z.array(z.number().int().min(1)).max(50).optional(),
      fingerprint: z.string().length(32).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  moveEnrollments(args: {
    journeyId: string;
    toVersion: number;
    nodeMap?: Record<string, string>;
    fromVersions?: number[];
    fingerprint?: string;
  }) {
    return this.runtime.moveEnrollments(args);
  }

  @McpTool({
    name: 'journeys_list_approvals',
    title: 'Journeys: List approval requests',
    description:
      'Approval steps waiting for, or decided by, a person: which journey and step, who it is about, what to check, and when it expires. Only a signed-in person decides them, in the Munin dashboard.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
      journeyId: Id.optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  listApprovals(args: { status?: string; journeyId?: string; limit: number }) {
    return this.runtime.listApprovals(args);
  }

  @McpTool({
    name: 'journeys_get_split_results',
    title: 'Journeys: Get split results',
    description:
      'Goal conversion per path of every split in the live version (or a given version): entered, converted, rate, lift against the control path and a two-proportion p-value once each path has 30 runs. Once a split with sampleSize is full, everyone goes to its control path and `winner` names the significantly better path, or the control when none is.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput.extend({ version: z.number().int().min(1).optional() }),
    readOnlyHint: true,
    destructiveHint: false,
  })
  getSplitResults(args: { journeyId: string; version?: number }) {
    return this.publishing.splitResults(args.journeyId, args.version);
  }

  @McpTool({
    name: 'journeys_propose_change',
    title: 'Journeys: Propose a change to a live journey',
    description:
      'Open a new draft version of a live journey from a full spec, with the hypothesis it tests, the rationale and the evidence behind it (report, agent and split numbers). The draft is validated and dry-run, and the result returns the diff against live and the simulation summary. It never publishes: a signed-in person reviews the proposal and publishes it. Refused while another unpublished draft is open.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      spec: z.record(z.string(), z.unknown()),
      hypothesis: z.string().min(1).max(500),
      rationale: z.string().min(1).max(4000),
      evidence: z.record(z.string(), z.unknown()).default({}),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeChange(args: {
    journeyId: string;
    spec: Record<string, unknown>;
    hypothesis: string;
    rationale: string;
    evidence: Record<string, unknown>;
  }) {
    return this.publishing.proposeChange(args);
  }

  @McpTool({
    name: 'journeys_get_guardrails',
    title: 'Journeys: Get guardrail status',
    description:
      'Bounce, unsubscribe and failed-step rates per step and for the whole journey over the guardrail window, against the thresholds that pause it (settings.guardrails, or the defaults: bounce 5%, unsubscribe 2%, failed steps 10%, from 50 sends or steps over 7 days). Shows which steps are paused.',
    audiences: ['admin'],
    scopes: ['journeys:read'],
    input: JourneyIdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getGuardrails(args: z.infer<typeof JourneyIdInput>) {
    return this.monitor.report(args.journeyId);
  }

  @McpTool({
    name: 'journeys_pause_node',
    title: 'Journeys: Pause a node',
    description:
      'Pause one step of a journey. Runs that reach it wait there, nobody is exited, and the rest of the journey keeps running. The monitor does the same on a guardrail breach.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ nodeId: z.string().min(1).max(48) }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  pauseNode(args: { journeyId: string; nodeId: string }) {
    return this.journeys.pauseNode(args.journeyId, args.nodeId);
  }

  @McpTool({
    name: 'journeys_resume_node',
    title: 'Journeys: Resume a paused node',
    description:
      'Resume a paused step. Runs held at it continue right away; the result says how many were released. Check journeys_get_guardrails first when the monitor paused it.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({ nodeId: z.string().min(1).max(48) }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  resumeNode(args: { journeyId: string; nodeId: string }) {
    return this.journeys.resumeNode(args.journeyId, args.nodeId);
  }

  @McpTool({
    name: 'journeys_pause',
    title: 'Journeys: Pause a live journey',
    description: 'Pause a live journey. Nobody is exited: waits hold and resume in order when the journey is resumed.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  pause(args: z.infer<typeof JourneyIdInput>) {
    return this.journeys.pause(args.journeyId);
  }

  @McpTool({
    name: 'journeys_resume',
    title: 'Journeys: Resume a paused journey',
    description: 'Resume a paused journey.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  resume(args: z.infer<typeof JourneyIdInput>) {
    return this.journeys.resume(args.journeyId);
  }

  @McpTool({
    name: 'journeys_archive',
    title: 'Journeys: Archive a journey',
    description: 'Archive a journey so it no longer runs or accepts edits. Its versions stay readable.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  archive(args: z.infer<typeof JourneyIdInput>) {
    return this.journeys.archive(args.journeyId);
  }
}

function assertNodeShape(node: unknown): void {
  const parsed = JourneyNodeSchema.safeParse(node);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || 'node'}: ${i.message}`)
      .join('; ');
    throw new BadRequestException(`journeys_invalid: ${detail}`);
  }
}

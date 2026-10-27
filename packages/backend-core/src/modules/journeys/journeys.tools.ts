import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import {
  JOURNEY_ACTIONS,
  JOURNEY_NODE_TYPES,
  JourneyNodeSchema,
  RESERVED_JOURNEY_NODE_TYPES,
} from '@getmunin/types';
import { JOURNEY_STATUSES, JourneysService } from './journeys.service.ts';
import { ENROLLMENT_STATES, JourneyRuntimeService, type EnrollmentState } from './journey-runtime.service.ts';
import { JourneyPublishingService } from './journey-publishing.service.ts';

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
    does: 'Send an email to the contact. approval: draft_only (default, filed for human review), auto (sends without review once a person publishes the version) or off (skipped).',
    fields: '{ channel: "email", class?: "marketing"|"transactional", content: { subject, body, format?: "markdown"|"mjml", preheader?, templateId? }, approval?, next?, onReply? }',
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
  ...RESERVED_JOURNEY_NODE_TYPES.map((type) => ({
    type,
    does: 'Not available yet; validation rejects it.',
    fields: '',
  })),
];

const JourneyIdInput = z.object({ journeyId: Id });

@Injectable()
export class JourneysTools {
  constructor(
    @Inject(JourneysService) private readonly journeys: JourneysService,
    @Inject(JourneyRuntimeService) private readonly runtime: JourneyRuntimeService,
    @Inject(JourneyPublishingService) private readonly publishing: JourneyPublishingService,
  ) {}

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
    title: 'Journeys: Enroll a person',
    description:
      'Put one contact or end user into a live journey now, as if its trigger fired. The entry segment, re-entry policy and holdout still apply; the result says whether they entered and, if not, why.',
    audiences: ['admin'],
    scopes: ['journeys:write'],
    input: JourneyIdInput.extend({
      contactId: Id.optional(),
      endUserId: Id.optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }),
    readOnlyHint: false,
    destructiveHint: true,
  })
  enroll(args: { journeyId: string; contactId?: string; endUserId?: string; context?: Record<string, unknown> }) {
    if (!args.contactId && !args.endUserId) {
      throw new BadRequestException('journeys_invalid: pass contactId or endUserId');
    }
    return this.runtime.enroll({
      journeyId: args.journeyId,
      subject: { contactId: args.contactId ?? null, endUserId: args.endUserId ?? null },
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
          '{ trigger: { type: "event", event, where? } | { type: "segment", segmentId, schedule: "once"|"daily"|"weekly", at?: "09:00", weekday?, timezone? } | { type: "manual" }, segmentId?, reentry?: "once"|"once_at_a_time", lateEventWindowHours?, lastEntryAt? }',
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
    scopes: ['journeys:read'],
    input: JourneyIdInput.extend({ version: z.number().int().min(1).optional() }),
    readOnlyHint: true,
    destructiveHint: false,
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

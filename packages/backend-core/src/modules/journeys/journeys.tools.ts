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
  constructor(@Inject(JourneysService) private readonly journeys: JourneysService) {}

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

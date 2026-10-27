import { z } from 'zod';

export const JOURNEY_NODE_TYPES = [
  'message',
  'action',
  'wait',
  'wait_for',
  'branch',
  'split',
  'goal',
  'jump',
  'exit',
  'agent',
  'approval',
  'sub_journey',
] as const;
export type JourneyNodeType = (typeof JOURNEY_NODE_TYPES)[number];

export const MAX_SUB_JOURNEY_DEPTH = 3;
export const DEFAULT_TRACE_RETENTION_DAYS = 365;

export const AGENT_NODE_MODES = ['decide', 'enrich'] as const;
export const ENRICH_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum'] as const;
export const AGENT_INPUTS = ['contact', 'company', 'reply', 'thread', 'events', 'context'] as const;
export type AgentInput = (typeof AGENT_INPUTS)[number];

export const JOURNEY_ACTIONS = [
  'crm.update_contact',
  'crm.add_tag',
  'crm.remove_tag',
  'crm.log_activity',
  'webhook.post',
] as const;
export type JourneyAction = (typeof JOURNEY_ACTIONS)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MESSAGE_APPROVAL_MODES = ['draft_only', 'auto', 'off'] as const;
export const MESSAGE_CLASSES = ['marketing', 'transactional'] as const;
export const MESSAGE_CHANNELS = ['email', 'sms', 'voice', 'chat'] as const;
export const JOURNEY_CHAT_MAX_CHARS = 2000;
export const JOURNEY_SMS_MAX_CHARS = 480;
export const JOURNEY_CALL_OPENING_MAX_CHARS = 1000;
export const CALL_OUTCOMES = ['reached', 'no_contact', 'refused', 'wrong_contact'] as const;
export const REENTRY_POLICIES = ['once', 'once_at_a_time', 'concurrent'] as const;
export const MAX_CONCURRENT_ENROLLMENTS = 20;
export const DEFAULT_JOURNEY_GUARDRAILS = {
  enabled: true,
  bounceRatePct: 5,
  unsubscribeRatePct: 2,
  failedStepRatePct: 10,
  minVolume: 50,
  windowDays: 7,
} as const;
export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'contains',
  'exists',
  'not_exists',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const NODE_ID_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const EVENT_NAME_PATTERN = /^[a-z0-9_.-]{1,64}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const ISO_DURATION_PATTERN = /^P(?!$)(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/;
const TIME_WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const NodeId = z.string().regex(NODE_ID_PATTERN, 'node ids are lower_snake_case');
export const EventName = z.string().regex(EVENT_NAME_PATTERN);
export const IsoDuration = z
  .string()
  .regex(ISO_DURATION_PATTERN, 'durations are ISO 8601, e.g. P5D or PT2H');
export const TimeWindow = z.string().regex(TIME_WINDOW_PATTERN, 'windows look like 20:00-08:00');
const PayloadMatch = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export type JourneyCondition =
  | { all: JourneyCondition[] }
  | { any: JourneyCondition[] }
  | { not: JourneyCondition }
  | { field: string; op: ConditionOperator; value?: unknown }
  | { context: string; op: ConditionOperator; value?: unknown }
  | { tag: string; present?: boolean }
  | {
      event: string;
      occurred?: boolean;
      since?: 'entry' | { days: number };
      minCount?: number;
    }
  | { segment: string; member?: boolean }
  | { time: { days?: Weekday[]; between?: string } };

export const JourneyConditionSchema: z.ZodType<JourneyCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(JourneyConditionSchema).min(1).max(20) }),
    z.strictObject({ any: z.array(JourneyConditionSchema).min(1).max(20) }),
    z.strictObject({ not: JourneyConditionSchema }),
    z.strictObject({
      field: z.string().regex(/^(contact|company)\.[a-zA-Z0-9_.]+$/),
      op: z.enum(CONDITION_OPERATORS),
      value: z.unknown().optional(),
    }),
    z.strictObject({
      context: z.string().regex(/^[a-zA-Z0-9_.]+$/),
      op: z.enum(CONDITION_OPERATORS),
      value: z.unknown().optional(),
    }),
    z.strictObject({ tag: z.string().min(1).max(64), present: z.boolean().optional() }),
    z.strictObject({
      event: EventName,
      occurred: z.boolean().optional(),
      since: z
        .union([z.literal('entry'), z.strictObject({ days: z.number().int().min(1).max(3650) })])
        .optional(),
      minCount: z.number().int().min(1).max(10_000).optional(),
    }),
    z.strictObject({ segment: z.string().min(1).max(64), member: z.boolean().optional() }),
    z.strictObject({
      time: z.strictObject({
        days: z.array(z.enum(WEEKDAYS)).min(1).max(7).optional(),
        between: TimeWindow.optional(),
      }),
    }),
  ]),
);

const NodeBase = { id: NodeId, label: z.string().max(120).optional() };

export const MessageNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('message'),
  channel: z.enum(MESSAGE_CHANNELS).default('email'),
  class: z.enum(MESSAGE_CLASSES).default('marketing'),
  content: z.strictObject({
    subject: z.string().min(1).max(300).optional(),
    preheader: z.string().max(300).optional(),
    format: z.enum(['markdown', 'mjml']).default('markdown'),
    body: z.string().min(1).max(100_000),
    templateId: z.string().min(1).max(64).optional(),
  }),
  approval: z.enum(MESSAGE_APPROVAL_MODES).default('draft_only'),
  draftBy: z.literal('agent').optional(),
  brief: z.string().min(1).max(2000).optional(),
  grounding: z.array(z.string().min(1).max(64)).max(5).optional(),
  locale: z.string().min(2).max(10).optional(),
  draftInputs: z.array(z.enum(AGENT_INPUTS)).max(AGENT_INPUTS.length).optional(),
  draftTimeout: IsoDuration.default('PT30M'),
  next: NodeId.optional(),
  onReply: NodeId.optional(),
  onOutcome: z
    .strictObject({
      reached: NodeId.optional(),
      no_contact: NodeId.optional(),
      refused: NodeId.optional(),
      wrong_contact: NodeId.optional(),
      timeout: NodeId.optional(),
    })
    .optional(),
  outcomeTimeout: IsoDuration.optional(),
  onUnseen: NodeId.optional(),
  seenTimeout: IsoDuration.optional(),
});

export const ActionNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('action'),
  action: z.enum(JOURNEY_ACTIONS),
  params: z.record(z.string(), z.unknown()).default({}),
  onFail: z.enum(['proceed', 'exit']).default('proceed'),
  retry: z.enum(['default', 'none']).default('default'),
  next: NodeId.optional(),
});

export const WaitNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('wait'),
  duration: IsoDuration.optional(),
  until: z.string().datetime({ offset: true }).optional(),
  untilField: z
    .strictObject({
      field: z.string().regex(/^(contact|context)\.[a-zA-Z0-9_.]+$/),
      offset: z.string().regex(/^-?P/).optional(),
    })
    .optional(),
  validDays: z.array(z.enum(WEEKDAYS)).min(1).max(7).optional(),
  validHours: TimeWindow.optional(),
  next: NodeId.optional(),
});

export const WaitForNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('wait_for'),
  event: z.string().min(1).max(96),
  where: PayloadMatch.optional(),
  timeout: IsoDuration,
  next: NodeId.optional(),
  onTimeout: NodeId.optional(),
});

export const BranchNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('branch'),
  rules: z
    .array(z.strictObject({ if: JourneyConditionSchema, next: NodeId }))
    .min(1)
    .max(20),
  default: NodeId,
});

export const SplitNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('split'),
  paths: z
    .array(
      z.strictObject({
        name: z.string().regex(NODE_ID_PATTERN),
        percent: z.number().int().min(1).max(100),
        next: NodeId,
      }),
    )
    .min(2)
    .max(10),
  control: z.string().regex(NODE_ID_PATTERN).optional(),
  sampleSize: z.number().int().min(20).max(1_000_000).optional(),
});

export const GoalNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('goal'),
  name: z.string().regex(REASON_PATTERN),
  exitOnReach: z.boolean().default(false),
  next: NodeId.optional(),
});

export const JumpNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('jump'),
  to: NodeId,
});

export const ExitNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('exit'),
  reason: z.string().regex(REASON_PATTERN).default('reached_end'),
});

export const AgentNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('agent'),
  mode: z.enum(AGENT_NODE_MODES),
  instructions: z.string().min(1).max(2000),
  edges: z.record(z.string().regex(NODE_ID_PATTERN), NodeId).optional(),
  fallback: z.string().regex(NODE_ID_PATTERN).optional(),
  fields: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/),
        type: z.enum(ENRICH_FIELD_TYPES),
        description: z.string().min(1).max(300),
        options: z.array(z.string().min(1).max(64)).max(20).optional(),
      }),
    )
    .max(12)
    .optional(),
  inputs: z.array(z.enum(AGENT_INPUTS)).min(1).max(AGENT_INPUTS.length),
  timeout: IsoDuration.default('PT10M'),
  next: NodeId.optional(),
});

export const ApprovalNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('approval'),
  title: z.string().min(1).max(200),
  instructions: z.string().min(1).max(2000).optional(),
  timeout: IsoDuration.default('P3D'),
  next: NodeId.optional(),
  onReject: NodeId.optional(),
  onTimeout: NodeId.optional(),
});

export const SubJourneyNodeSchema = z.strictObject({
  ...NodeBase,
  type: z.literal('sub_journey'),
  journeyId: z.string().min(1).max(64),
  await: z.boolean().default(false),
  timeout: IsoDuration.default('P30D'),
  next: NodeId.optional(),
  onGoal: NodeId.optional(),
});

export const JourneyNodeSchema = z.discriminatedUnion('type', [
  MessageNodeSchema,
  ActionNodeSchema,
  WaitNodeSchema,
  WaitForNodeSchema,
  BranchNodeSchema,
  SplitNodeSchema,
  GoalNodeSchema,
  JumpNodeSchema,
  ExitNodeSchema,
  AgentNodeSchema,
  ApprovalNodeSchema,
  SubJourneyNodeSchema,
]);

export const JourneyTriggerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('event'),
    event: z.string().min(1).max(96),
    where: PayloadMatch.optional(),
  }),
  z.strictObject({
    type: z.literal('segment'),
    segmentId: z.string().min(1).max(64),
    schedule: z.enum(['once', 'daily', 'weekly']),
    at: z.string().regex(CLOCK_PATTERN).default('09:00'),
    weekday: z.enum(WEEKDAYS).optional(),
    timezone: z.string().min(1).max(64).optional(),
  }),
  z.strictObject({ type: z.literal('manual') }),
]);

export const JOURNEY_SUBJECTS = ['contact', 'company'] as const;

export const JourneyEntrySchema = z.strictObject({
  trigger: JourneyTriggerSchema,
  subject: z.enum(JOURNEY_SUBJECTS).default('contact'),
  segmentId: z.string().min(1).max(64).optional(),
  reentry: z.enum(REENTRY_POLICIES).default('once_at_a_time'),
  lateEventWindowHours: z.number().int().min(0).max(168).default(6),
  lastEntryAt: z.string().datetime({ offset: true }).optional(),
});

export const JourneyExitSchema = z.strictObject({
  idleDays: z.number().int().min(1).max(365).optional(),
  on: z
    .array(z.strictObject({ event: z.string().min(1).max(96), where: PayloadMatch.optional() }))
    .max(10)
    .default([]),
});

export const JourneyGoalSchema = z.strictObject({
  event: z.string().min(1).max(96),
  where: PayloadMatch.optional(),
  windowDays: z.number().int().min(1).max(365),
  exitOnGoal: z.boolean().default(true),
});

export const JourneySettingsSchema = z.strictObject({
  timezone: z.string().min(1).max(64).optional(),
  quietHours: TimeWindow.optional(),
  validDays: z.array(z.enum(WEEKDAYS)).min(1).max(7).optional(),
  holdoutPct: z.number().int().min(0).max(50).default(0),
  frequencyCapPerWeek: z.number().int().min(1).max(50).optional(),
  cooldownHoursAfterConversation: z.number().int().min(0).max(720).default(24),
  maxVisitsPerNode: z.number().int().min(1).max(20).default(3),
  smsChannelId: z.string().min(1).max(64).optional(),
  voiceChannelId: z.string().min(1).max(64).optional(),
  chatChannelId: z.string().min(1).max(64).optional(),
  optimiser: z.enum(['off', 'weekly']).optional(),
  traceRetentionDays: z.number().int().min(30).max(3650).optional(),
  guardrails: z
    .strictObject({
      enabled: z.boolean().optional(),
      bounceRatePct: z.number().min(0.1).max(100).optional(),
      unsubscribeRatePct: z.number().min(0.1).max(100).optional(),
      failedStepRatePct: z.number().min(0.1).max(100).optional(),
      minVolume: z.number().int().min(10).max(100_000).optional(),
      windowDays: z.number().int().min(1).max(90).optional(),
    })
    .optional(),
});

export const JourneySpecSchema = z.strictObject({
  entry: JourneyEntrySchema,
  exit: JourneyExitSchema.default({ on: [] }),
  goal: JourneyGoalSchema.optional(),
  settings: JourneySettingsSchema.default({
    holdoutPct: 0,
    cooldownHoursAfterConversation: 24,
    maxVisitsPerNode: 3,
  }),
  start: NodeId,
  nodes: z.array(JourneyNodeSchema).min(1).max(100),
});

export type JourneySpec = z.infer<typeof JourneySpecSchema>;
export type JourneySpecInput = z.input<typeof JourneySpecSchema>;
export type JourneyNode = z.infer<typeof JourneyNodeSchema>;
export type JourneyNodeInput = z.input<typeof JourneyNodeSchema>;
export type JourneyTrigger = z.infer<typeof JourneyTriggerSchema>;
export type MessageNode = z.infer<typeof MessageNodeSchema>;
export type ApprovalNode = z.infer<typeof ApprovalNodeSchema>;
export type SubJourneyNode = z.infer<typeof SubJourneyNodeSchema>;
export type ActionNode = z.infer<typeof ActionNodeSchema>;
export type WaitNode = z.infer<typeof WaitNodeSchema>;
export type WaitForNode = z.infer<typeof WaitForNodeSchema>;
export type BranchNode = z.infer<typeof BranchNodeSchema>;
export type SplitNode = z.infer<typeof SplitNodeSchema>;
export type AgentNode = z.infer<typeof AgentNodeSchema>;

export function parseIsoDurationMs(value: string): number | null {
  const m = ISO_DURATION_PATTERN.exec(value);
  if (!m) return null;
  const n = (s: string | undefined) => (s ? Number.parseInt(s, 10) : 0);
  const weeks = n(m[1]);
  const days = n(m[2]);
  const hours = n(m[4]);
  const minutes = n(m[5]);
  return (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60_000;
}

export function journeyNodeEdges(node: JourneyNode): { label: string; to: string }[] {
  const edges: { label: string; to: string }[] = [];
  const add = (label: string, to: string | undefined) => {
    if (to) edges.push({ label, to });
  };
  switch (node.type) {
    case 'message':
      add('next', node.next);
      add('on_reply', node.onReply);
      for (const [outcome, to] of Object.entries(node.onOutcome ?? {})) add(`outcome_${outcome}`, to);
      add('on_unseen', node.onUnseen);
      break;
    case 'action':
    case 'wait':
    case 'goal':
      add('next', node.next);
      break;
    case 'wait_for':
      add('next', node.next);
      add('on_timeout', node.onTimeout);
      break;
    case 'branch':
      node.rules.forEach((r, i) => add(`rule_${i + 1}`, r.next));
      add('default', node.default);
      break;
    case 'split':
      for (const p of node.paths) add(p.name, p.next);
      break;
    case 'jump':
      add('jump', node.to);
      break;
    case 'agent':
      for (const [label, to] of Object.entries(node.edges ?? {})) add(label, to);
      add('next', node.next);
      break;
    case 'approval':
      add('next', node.next);
      add('on_reject', node.onReject);
      add('on_timeout', node.onTimeout);
      break;
    case 'sub_journey':
      add('next', node.next);
      add('on_goal', node.onGoal);
      break;
    default:
      break;
  }
  return edges;
}

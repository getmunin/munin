import {
  JOURNEY_CALL_OPENING_MAX_CHARS,
  JOURNEY_CHAT_MAX_CHARS,
  JOURNEY_SMS_MAX_CHARS,
  JourneySpecSchema,
  journeyNodeEdges,
  type JourneyNode,
  type JourneySpec,
} from '@getmunin/types';
import { collectConditionNeeds } from './journey-conditions.ts';

export interface JourneyIssue {
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
}

export interface JourneyValidation {
  valid: boolean;
  errors: JourneyIssue[];
  warnings: JourneyIssue[];
}

export interface JourneyReferences {
  segmentIds: ReadonlySet<string>;
  emailTemplateIds: ReadonlySet<string>;
  webhookIds: ReadonlySet<string>;
  smsChannelIds?: ReadonlySet<string>;
  voiceChannelIds?: ReadonlySet<string>;
  chatChannelIds?: ReadonlySet<string>;
  selfJourneyId?: string;
  journeys?: ReadonlyMap<string, { status: string; calls: readonly string[] }>;
  llmConfigured?: boolean;
}

export interface ParsedJourneySpec {
  spec: JourneySpec | null;
  validation: JourneyValidation;
}

const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set(['timezone', 'locale', 'language']);

const WAITING_NODE_TYPES: ReadonlySet<string> = new Set(['wait', 'wait_for', 'message', 'agent', 'approval', 'sub_journey']);

export function parseJourneySpec(input: unknown): ParsedJourneySpec {
  const parsed = JourneySpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      spec: null,
      validation: {
        valid: false,
        errors: parsed.error.issues.map((issue) => ({
          code: 'schema',
          message: issue.message,
          path: issue.path.join('.'),
        })),
        warnings: [],
      },
    };
  }
  return { spec: parsed.data, validation: { valid: true, errors: [], warnings: [] } };
}

export function validateJourneySpec(spec: JourneySpec, refs: JourneyReferences): JourneyValidation {
  const errors: JourneyIssue[] = [];
  const warnings: JourneyIssue[] = [];
  const byId = new Map<string, JourneyNode>();

  for (const node of spec.nodes) {
    if (byId.has(node.id)) {
      errors.push({ code: 'duplicate_node', nodeId: node.id, message: `node id "${node.id}" is used twice` });
    }
    byId.set(node.id, node);
  }
  if (!byId.has(spec.start)) {
    errors.push({ code: 'missing_start', message: `start node "${spec.start}" does not exist` });
  }

  for (const node of spec.nodes) {
    const edges = journeyNodeEdges(node);
    for (const edge of edges) {
      if (!byId.has(edge.to)) {
        errors.push({
          code: 'dangling_edge',
          nodeId: node.id,
          message: `edge "${edge.label}" points to missing node "${edge.to}"`,
        });
      }
    }
    if (edges.length === 0 && node.type !== 'exit') {
      warnings.push({
        code: 'implicit_end',
        nodeId: node.id,
        message: 'node has no outgoing edge; contacts reaching it exit with reached_end',
      });
    }
    checkNode(node, refs, errors, warnings);
  }

  const reachable = reachableFrom(spec.start, byId);
  for (const node of spec.nodes) {
    if (!reachable.has(node.id)) {
      errors.push({ code: 'unreachable_node', nodeId: node.id, message: 'no path from the start node reaches this node' });
    }
  }

  for (const cycle of tightCycles(byId)) {
    errors.push({
      code: 'loop_without_wait',
      nodeId: cycle[0],
      message: `loop ${cycle.join(' → ')} has no wait, wait_for or message node, so it would spin until the visit cap`,
    });
  }

  const segmentRefs = new Set<string>();
  if (spec.entry.segmentId) segmentRefs.add(spec.entry.segmentId);
  if (spec.entry.trigger.type === 'segment') segmentRefs.add(spec.entry.trigger.segmentId);
  for (const node of spec.nodes) {
    if (node.type === 'branch') {
      for (const rule of node.rules) {
        for (const id of collectConditionNeeds(rule.if).segmentIds) segmentRefs.add(id);
      }
    }
  }
  for (const id of segmentRefs) {
    if (!refs.segmentIds.has(id)) {
      errors.push({ code: 'unknown_segment', message: `segment "${id}" does not exist` });
    }
  }

  if (spec.nodes.some((n) => n.type === 'message' && n.channel === 'sms')) {
    const channelId = spec.settings.smsChannelId;
    if (!channelId) {
      errors.push({ code: 'sms_channel', message: 'SMS steps need settings.smsChannelId, an SMS channel to send from' });
    } else if (refs.smsChannelIds && !refs.smsChannelIds.has(channelId)) {
      errors.push({ code: 'sms_channel', message: `"${channelId}" is not an SMS channel in this organization` });
    }
  }

  if (spec.nodes.some((n) => n.type === 'message' && n.channel === 'chat')) {
    const channelId = spec.settings.chatChannelId;
    if (!channelId) {
      errors.push({ code: 'chat_channel', message: 'chat steps need settings.chatChannelId, a chat widget channel to write in' });
    } else if (refs.chatChannelIds && !refs.chatChannelIds.has(channelId)) {
      errors.push({ code: 'chat_channel', message: `"${channelId}" is not a chat widget channel in this organization` });
    }
  }

  if (spec.nodes.some((n) => n.type === 'message' && n.channel === 'voice')) {
    const channelId = spec.settings.voiceChannelId;
    if (!channelId) {
      errors.push({ code: 'voice_channel', message: 'call steps need settings.voiceChannelId, a voice channel to call from' });
    } else if (refs.voiceChannelIds && !refs.voiceChannelIds.has(channelId)) {
      errors.push({ code: 'voice_channel', message: `"${channelId}" is not a voice channel in this organization` });
    }
  }

  for (const node of spec.nodes) {
    if (node.type !== 'sub_journey') continue;
    const target = refs.journeys?.get(node.journeyId);
    if (refs.journeys && !target) {
      errors.push({ code: 'unknown_journey', nodeId: node.id, message: `journey "${node.journeyId}" does not exist` });
      continue;
    }
    if (refs.selfJourneyId && reachesJourney(node.journeyId, refs.selfJourneyId, refs.journeys)) {
      errors.push({
        code: 'sub_journey_cycle',
        nodeId: node.id,
        message: `journey "${node.journeyId}" leads back into this journey, so a person could loop between them`,
      });
    } else if (target && target.status !== 'live') {
      warnings.push({
        code: 'sub_journey_not_live',
        nodeId: node.id,
        message: `journey "${node.journeyId}" is ${target.status}; until it is live, people pass this step without entering it`,
      });
    }
  }

  if (spec.entry.reentry === 'concurrent') {
    if (spec.entry.trigger.type !== 'event') {
      errors.push({
        code: 'concurrent_trigger',
        message: 'concurrent re-entry starts one run per event, so it needs an event trigger',
      });
    }
    const messages = spec.nodes.filter((n) => n.type === 'message').map((n) => n.id);
    if (messages.length > 0) {
      errors.push({
        code: 'concurrent_messages',
        message: `concurrent runs cannot send messages (${messages.join(', ')}): parallel runs would message the same person several times; use once_at_a_time`,
      });
    }
  }

  if (!spec.goal) {
    errors.push({ code: 'missing_goal', message: 'every journey needs a goal event and attribution window' });
  }
  if (spec.entry.trigger.type === 'event' && spec.entry.trigger.event.startsWith('journey.')) {
    errors.push({
      code: 'self_trigger',
      message: 'journey.* events cannot enter contacts into a journey',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function checkNode(
  node: JourneyNode,
  refs: JourneyReferences,
  errors: JourneyIssue[],
  warnings: JourneyIssue[],
): void {
  switch (node.type) {
    case 'message':
      if (node.channel !== 'chat' && (node.onUnseen || node.seenTimeout)) {
        errors.push({ code: 'unseen_edges', nodeId: node.id, message: 'onUnseen and seenTimeout apply to chat steps only' });
      }
      if (node.channel === 'chat') {
        checkChatNode(node, errors);
        break;
      }
      if (node.channel === 'voice') {
        checkCallNode(node, errors);
        break;
      }
      if (node.onOutcome || node.outcomeTimeout) {
        errors.push({ code: 'outcome_edges', nodeId: node.id, message: 'onOutcome and outcomeTimeout apply to call steps only' });
      }
      if (node.channel === 'sms') {
        checkSmsNode(node, errors);
        break;
      }
      if (!node.content.subject) {
        errors.push({ code: 'missing_subject', nodeId: node.id, message: 'an email step needs a subject' });
      }
      if (node.draftBy === 'agent') {
        if (!node.brief) {
          errors.push({ code: 'agent_draft_brief', nodeId: node.id, message: 'an agent-drafted email needs a brief' });
        }
        if (node.approval === 'auto') {
          warnings.push({
            code: 'agent_draft_auto',
            nodeId: node.id,
            message: 'an agent-drafted step can be published with auto only once it has 30 reviewed drafts in 30 days with at least 90% approved unedited',
          });
        }
      }
      if (node.content.templateId && !refs.emailTemplateIds.has(node.content.templateId)) {
        errors.push({
          code: 'unknown_template',
          nodeId: node.id,
          message: `email template "${node.content.templateId}" does not exist`,
        });
      }
      break;
    case 'wait': {
      const modes = [node.duration, node.until, node.untilField].filter(Boolean).length;
      if (modes !== 1) {
        errors.push({
          code: 'wait_mode',
          nodeId: node.id,
          message: 'a wait node needs exactly one of duration, until or untilField',
        });
      }
      break;
    }
    case 'wait_for':
      if (!node.onTimeout) {
        warnings.push({
          code: 'timeout_ends_journey',
          nodeId: node.id,
          message: 'no onTimeout edge; contacts whose wait times out exit with wait_timeout',
        });
      }
      break;
    case 'split': {
      const total = node.paths.reduce((sum, p) => sum + p.percent, 0);
      if (node.control && !node.paths.some((p) => p.name === node.control)) {
        errors.push({ code: 'split_control', nodeId: node.id, message: `control "${node.control}" is not one of the split's paths` });
      }
      if (node.sampleSize && !node.control) {
        errors.push({ code: 'split_control', nodeId: node.id, message: 'a split with sampleSize needs a control path to send everyone to once the sample is full' });
      }
      if (total !== 100) {
        errors.push({ code: 'split_total', nodeId: node.id, message: `split percentages add up to ${total}, not 100` });
      }
      break;
    }
    case 'action':
      checkAction(node, refs, errors);
      break;
    case 'agent':
      if (node.mode === 'decide') {
        const edges = Object.keys(node.edges ?? {});
        if (edges.length < 2 || edges.length > 10) {
          errors.push({ code: 'agent_edges', nodeId: node.id, message: 'a decide step declares between 2 and 10 edges' });
        }
        if (!node.fallback || !edges.includes(node.fallback)) {
          errors.push({
            code: 'agent_fallback',
            nodeId: node.id,
            message: `fallback "${node.fallback ?? ''}" must be one of the declared edges (${edges.join(', ')})`,
          });
        }
        if (node.next || node.fields) {
          errors.push({ code: 'agent_mode_fields', nodeId: node.id, message: 'a decide step uses edges and fallback, not next or fields' });
        }
      } else {
        if (!node.fields?.length) {
          errors.push({ code: 'agent_fields', nodeId: node.id, message: 'an enrich step declares at least one field' });
        }
        if (node.edges || node.fallback) {
          errors.push({ code: 'agent_mode_fields', nodeId: node.id, message: 'an enrich step uses fields and next, not edges' });
        }
        for (const field of node.fields ?? []) {
          if (RESERVED_FIELD_KEYS.has(field.key) || field.key.startsWith('outreachOutcome')) {
            errors.push({ code: 'agent_fields', nodeId: node.id, message: `"${field.key}" is set by Munin itself; choose another key` });
          }
          if (field.type === 'enum' && !field.options?.length) {
            errors.push({ code: 'agent_fields', nodeId: node.id, message: `enum field "${field.key}" needs options` });
          }
        }
      }
      if (refs.llmConfigured === false) {
        warnings.push({
          code: 'agent_without_model',
          nodeId: node.id,
          message: 'no LLM provider is configured, so every contact takes the fallback edge after the timeout',
        });
      }
      if (node.inputs.includes('reply') || node.inputs.includes('thread')) {
        warnings.push({
          code: 'agent_reads_conversation',
          nodeId: node.id,
          message: 'reply and thread inputs are empty until the contact has a journey conversation',
        });
      }
      break;
    default:
      break;
  }
}

function checkAction(
  node: Extract<JourneyNode, { type: 'action' }>,
  refs: JourneyReferences,
  errors: JourneyIssue[],
): void {
  const p = node.params;
  const fail = (message: string) => errors.push({ code: 'action_params', nodeId: node.id, message });
  switch (node.action) {
    case 'crm.add_tag':
    case 'crm.remove_tag':
      if (typeof p.tag !== 'string' || p.tag.length === 0 || p.tag.length > 64) {
        fail(`${node.action} needs params.tag (1–64 characters)`);
      }
      break;
    case 'crm.update_contact':
      if (!p.fields || typeof p.fields !== 'object' || Array.isArray(p.fields)) {
        fail('crm.update_contact needs params.fields as an object');
      }
      break;
    case 'crm.log_activity':
      if (typeof p.subject !== 'string' || p.subject.length === 0) {
        fail('crm.log_activity needs params.subject');
      }
      break;
    case 'webhook.post':
      if (typeof p.webhookId !== 'string' || !refs.webhookIds.has(p.webhookId)) {
        fail('webhook.post needs params.webhookId naming an existing webhook');
      }
      break;
  }
}

function reachableFrom(start: string, byId: Map<string, JourneyNode>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    seen.add(id);
    for (const edge of journeyNodeEdges(node)) stack.push(edge.to);
  }
  return seen;
}

function tightCycles(byId: Map<string, JourneyNode>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string) => {
    const node = byId.get(id);
    if (!node || WAITING_NODE_TYPES.has(node.type)) return;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      cycles.push(path.slice(path.indexOf(id)));
      return;
    }
    state.set(id, 'open');
    path.push(id);
    for (const edge of journeyNodeEdges(node)) visit(edge.to);
    path.pop();
    state.set(id, 'done');
  };
  for (const id of byId.keys()) visit(id);
  return cycles;
}

function checkSmsNode(node: Extract<JourneyNode, { type: 'message' }>, errors: JourneyIssue[]): void {
  const fail = (code: string, message: string) => errors.push({ code, nodeId: node.id, message });
  if (node.approval === 'auto') {
    fail('sms_auto', 'SMS steps are always approved by a person; use draft_only');
  }
  if (node.draftBy === 'agent' && !node.brief) {
    fail('agent_draft_brief', 'an agent-drafted message needs a brief');
  }
  if (node.content.subject || node.content.preheader || node.content.templateId || node.content.format === 'mjml') {
    fail('sms_content', 'an SMS step has only content.body: no subject, preheader, template or MJML');
  }
  if (node.content.body.length > JOURNEY_SMS_MAX_CHARS) {
    fail('sms_length', `SMS text is ${node.content.body.length} characters; the limit is ${JOURNEY_SMS_MAX_CHARS}`);
  }
}

function checkCallNode(node: Extract<JourneyNode, { type: 'message' }>, errors: JourneyIssue[]): void {
  const fail = (code: string, message: string) => errors.push({ code, nodeId: node.id, message });
  if (node.approval !== 'draft_only') {
    fail('voice_approval', 'a person approves every call; call steps use draft_only');
  }
  if (node.draftBy === 'agent' && !node.brief) {
    fail('agent_draft_brief', 'an agent-drafted message needs a brief');
  }
  if (node.onReply) {
    fail('voice_reply', 'a call has no reply; branch on onOutcome instead');
  }
  if (node.content.subject || node.content.preheader || node.content.templateId || node.content.format === 'mjml') {
    fail('voice_content', 'a call step has only content.body, the opening the voice agent uses');
  }
  if (node.content.body.length > JOURNEY_CALL_OPENING_MAX_CHARS) {
    fail('voice_length', `the call opening is ${node.content.body.length} characters; the limit is ${JOURNEY_CALL_OPENING_MAX_CHARS}`);
  }
}

function reachesJourney(
  from: string,
  target: string,
  journeys: ReadonlyMap<string, { status: string; calls: readonly string[] }> | undefined,
): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(journeys?.get(id)?.calls ?? []));
  }
  return false;
}

function checkChatNode(node: Extract<JourneyNode, { type: 'message' }>, errors: JourneyIssue[]): void {
  const fail = (code: string, message: string) => errors.push({ code, nodeId: node.id, message });
  if (node.onOutcome || node.outcomeTimeout) {
    fail('outcome_edges', 'onOutcome and outcomeTimeout apply to call steps only');
  }
  if (node.content.subject || node.content.preheader || node.content.templateId || node.content.format === 'mjml') {
    fail('chat_content', 'a chat step has only content.body, in markdown: no subject, preheader, template or MJML');
  }
  if (node.content.body.length > JOURNEY_CHAT_MAX_CHARS) {
    fail('chat_length', `the chat message is ${node.content.body.length} characters; the limit is ${JOURNEY_CHAT_MAX_CHARS}`);
  }
  if (node.draftBy === 'agent' && !node.brief) {
    fail('agent_draft_brief', 'an agent-drafted message needs a brief');
  }
}

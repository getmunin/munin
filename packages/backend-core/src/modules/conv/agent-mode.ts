import { AGENT_MODES, type AgentMode } from './agent-modes.ts';

export const AGENT_MODE_SOURCES = ['default', 'explicit'] as const;
export type AgentModeSource = (typeof AGENT_MODE_SOURCES)[number];

export function isAgentMode(value: string | null | undefined): value is AgentMode {
  return value != null && (AGENT_MODES as readonly string[]).includes(value);
}

export function resolveEffectiveAgentMode(input: {
  conversationMode: AgentMode;
  source: string;
  topicMode: string | null;
}): AgentMode {
  if (input.source === 'explicit') return input.conversationMode;
  if (isAgentMode(input.topicMode)) return input.topicMode;
  return input.conversationMode;
}

export const AUTOMATION_WINDOW_DAYS = 30;
export const AUTOMATION_MIN_SAMPLE = 20;
export const AUTOMATION_MIN_UNEDITED_RATE = 0.85;
export const AUTOMATION_MAX_REJECTED_RATE = 0.05;

export type AutomationHold = 'sample' | 'unedited' | 'rejected' | null;

export function automationHold(counts: {
  unedited: number;
  edited: number;
  rejected: number;
}): AutomationHold {
  const total = counts.unedited + counts.edited + counts.rejected;
  if (total < AUTOMATION_MIN_SAMPLE) return 'sample';
  if (counts.rejected / total > AUTOMATION_MAX_REJECTED_RATE) return 'rejected';
  if (counts.unedited / total < AUTOMATION_MIN_UNEDITED_RATE) return 'unedited';
  return null;
}

export function ratePercent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

export type ActorKind = 'user' | 'agent' | 'widget' | 'system' | 'unknown';

export const AGENT_HOST_ACTOR = 'agent-host';
export const AGENT_HOST_ACTOR_PREFIX = `${AGENT_HOST_ACTOR}:`;

export const CONV_SCHEDULER_ACTOR = 'conv-scheduler';
export const CURATOR_SCHEDULER_ACTOR = 'curator-scheduler';
export const WIDGET_READ_TRACKER_ACTOR = 'widget-read-tracker';

export const SYSTEM_ACTOR_IDS: readonly string[] = [
  'system',
  CONV_SCHEDULER_ACTOR,
  CURATOR_SCHEDULER_ACTOR,
  WIDGET_READ_TRACKER_ACTOR,
];

export function actorKindFromId(id: string): ActorKind {
  if (id === AGENT_HOST_ACTOR || id.startsWith(AGENT_HOST_ACTOR_PREFIX)) return 'agent';
  return SYSTEM_ACTOR_IDS.includes(id) ? 'system' : 'unknown';
}

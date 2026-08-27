export const AGENT_MODES = ['auto', 'draft_only', 'off'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

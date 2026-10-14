import { BadRequestException } from '@nestjs/common';
import type { AgentMode } from '@getmunin/types';

export function requireChosenAgentMode(
  mode: AgentMode | undefined,
  channelKind: 'email' | 'sms' | 'chat widget',
): AgentMode {
  if (mode) return mode;
  throw new BadRequestException(
    `conv_agent_mode_required: a ${channelKind} channel that receives messages needs defaultAgentMode — 'auto' sends the agent's replies directly, 'draft_only' parks each reply as a draft a person reviews and sends, 'off' keeps the agent out. There is no default; the organization chooses.`,
  );
}

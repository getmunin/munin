export type SetupStage = 'unconfigured' | 'listening' | 'active';

export type SetupChannelType = 'email' | 'chat' | 'sms' | 'voice';

export interface SetupChannelDto {
  id: string;
  type: SetupChannelType;
  vendor: string;
  name: string;
  active: boolean;
  config: Record<string, unknown>;
  needsCredentials?: boolean;
}

export interface SetupStateDto {
  channels: SetupChannelDto[];
  conversationCount: number;
  topicCount: number;
  knowledgeDocumentCount: number;
  externalMcpCallCount: number;
  lastExternalMcpCallAt: string | null;
}

export interface SetupChannel {
  id: string;
  type: SetupChannelType;
  label: string;
}

export interface SetupSnapshot {
  known: boolean;
  stage: SetupStage;
  liveChannels: SetupChannel[];
  pendingChannels: SetupChannel[];
  agentConnected: boolean;
  externalMcpCallCount: number;
  lastExternalMcpCallAt: string | null;
  conversationCount: number;
  topicCount: number;
  knowledgeDocumentCount: number;
}

const CHANNEL_ORDER: SetupChannelType[] = ['email', 'chat', 'sms', 'voice'];

const UNKNOWN: SetupSnapshot = {
  known: false,
  stage: 'active',
  liveChannels: [],
  pendingChannels: [],
  agentConnected: false,
  externalMcpCallCount: 0,
  lastExternalMcpCallAt: null,
  conversationCount: 0,
  topicCount: 0,
  knowledgeDocumentCount: 0,
};

export function toSetupSnapshot(dto: SetupStateDto | null): SetupSnapshot {
  if (!dto) return UNKNOWN;

  const live = dto.channels.filter(isLive);
  const pending = dto.channels.filter((channel) => !isLive(channel));

  return {
    known: true,
    stage:
      dto.conversationCount > 0 ? 'active' : live.length > 0 ? 'listening' : 'unconfigured',
    liveChannels: toSetupChannels(live),
    pendingChannels: toSetupChannels(pending),
    agentConnected: dto.externalMcpCallCount > 0,
    externalMcpCallCount: dto.externalMcpCallCount,
    lastExternalMcpCallAt: dto.lastExternalMcpCallAt,
    conversationCount: dto.conversationCount,
    topicCount: dto.topicCount,
    knowledgeDocumentCount: dto.knowledgeDocumentCount,
  };
}

function isLive(channel: SetupChannelDto): boolean {
  return channel.active && channel.needsCredentials !== true;
}

function toSetupChannels(channels: SetupChannelDto[]): SetupChannel[] {
  return channels
    .map((channel) => ({
      id: channel.id,
      type: channel.type,
      label: channelLabel(channel),
    }))
    .sort(
      (a, b) =>
        CHANNEL_ORDER.indexOf(a.type) - CHANNEL_ORDER.indexOf(b.type) ||
        a.label.localeCompare(b.label),
    );
}

function channelLabel(channel: SetupChannelDto): string {
  const config = channel.config as {
    addressing?: { fromAddress?: string };
    originAllowlist?: string[];
    fromNumber?: string | null;
    originator?: string;
  };
  switch (channel.type) {
    case 'email':
      return config.addressing?.fromAddress ?? channel.name;
    case 'chat':
      return config.originAllowlist?.[0] ?? channel.name;
    case 'sms':
      return config.fromNumber ?? config.originator ?? channel.name;
    default:
      return channel.name;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type { Audience } from '@getmunin/core';
import type { Db, Tx } from '@getmunin/db';
import type { RegisteredMcpTool } from '@getmunin/mcp-toolkit';
import { McpRegistryService } from '../../../mcp/mcp.registry.ts';
import { ConnectorsService } from '../../connectors/connectors.service.ts';
import type { ConnectorDomain } from '../../connectors/connector.ts';

export const VOICE_CHANNEL_KIND = 'voice';

const SELF_SERVICE_TOOL_PREFIX_BY_DOMAIN = {
  commerce: 'commerce_',
  bookings: 'bookings_',
  mcp: 'ext_',
} satisfies Partial<Record<ConnectorDomain, string>>;

type SelfServiceConnectorDomain = keyof typeof SELF_SERVICE_TOOL_PREFIX_BY_DOMAIN;

const CONNECTOR_DOMAINS = Object.keys(
  SELF_SERVICE_TOOL_PREFIX_BY_DOMAIN,
) as SelfServiceConnectorDomain[];

interface ToolLister {
  list(audience?: Audience, opts?: { channelKind?: string }): RegisteredMcpTool[];
}

interface ConnectorDomainReader {
  listActiveDomains(
    orgId: string,
    domains: readonly ConnectorDomain[],
    db?: Db | Tx,
  ): Promise<Set<ConnectorDomain>>;
}

function domainOf(toolName: string): SelfServiceConnectorDomain | null {
  return (
    CONNECTOR_DOMAINS.find((d) =>
      toolName.startsWith(SELF_SERVICE_TOOL_PREFIX_BY_DOMAIN[d]),
    ) ?? null
  );
}

@Injectable()
export class VoiceSelfServiceToolsService {
  constructor(
    @Inject(McpRegistryService) private readonly registry: ToolLister,
    @Inject(ConnectorsService) private readonly connectors: ConnectorDomainReader,
  ) {}

  async list(orgId: string, db?: Db | Tx): Promise<RegisteredMcpTool[]> {
    const candidates = this.registry.list('self_service', { channelKind: VOICE_CHANNEL_KIND });
    const needed = CONNECTOR_DOMAINS.filter((domain) =>
      candidates.some((t) => t.meta.name.startsWith(SELF_SERVICE_TOOL_PREFIX_BY_DOMAIN[domain])),
    );
    const active = await this.connectors.listActiveDomains(orgId, needed, db);

    return candidates.filter((t) => {
      const domain = domainOf(t.meta.name);
      return !domain || active.has(domain);
    });
  }

  isCallable(tool: RegisteredMcpTool): boolean {
    return !tool.meta.excludeChannelKinds?.includes(VOICE_CHANNEL_KIND);
  }
}

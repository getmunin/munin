import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Audience } from '@getmunin/core';
import type { RegisteredMcpTool } from '@getmunin/mcp-toolkit';
import { VoiceSelfServiceToolsService } from './voice-self-service-tools.service.ts';
import type { ConnectorDomain } from '../../connectors/connector.ts';

function tool(name: string, excludeChannelKinds?: readonly string[]): RegisteredMcpTool {
  return {
    meta: {
      name,
      description: name,
      audiences: ['self_service'],
      scopes: [],
      input: z.object({}),
      excludeChannelKinds,
    },
    handler: () => null,
    inputJsonSchema: { type: 'object' },
  };
}

function fakeRegistry(tools: RegisteredMcpTool[]) {
  return {
    list: (_audience?: Audience, opts?: { channelKind?: string }) =>
      opts?.channelKind
        ? tools.filter((t) => !t.meta.excludeChannelKinds?.includes(opts.channelKind!))
        : tools,
  };
}

function fakeConnectors(activeDomains: ConnectorDomain[]) {
  const asked: Array<readonly ConnectorDomain[]> = [];
  return {
    asked,
    listActiveDomains: (_orgId: string, domains: readonly ConnectorDomain[]) => {
      asked.push(domains);
      return Promise.resolve(new Set(domains.filter((d) => activeDomains.includes(d))));
    },
  };
}

describe('VoiceSelfServiceToolsService', () => {
  it('drops connector-backed tools when the org has no active connection for that domain', async () => {
    const tools = [
      tool('kb_search'),
      tool('commerce_list_my_orders'),
      tool('bookings_list_my_bookings'),
    ];
    const connectors = fakeConnectors(['commerce']);
    const svc = new VoiceSelfServiceToolsService(fakeRegistry(tools), connectors);

    const result = await svc.list('org_1');

    expect(result.map((t) => t.meta.name)).toEqual(['kb_search', 'commerce_list_my_orders']);
  });

  it('keeps connector-backed tools when the domain has an active connection', async () => {
    const tools = [tool('commerce_list_my_orders'), tool('bookings_list_my_bookings')];
    const connectors = fakeConnectors(['commerce', 'bookings']);
    const svc = new VoiceSelfServiceToolsService(fakeRegistry(tools), connectors);

    const result = await svc.list('org_1');

    expect(result.map((t) => t.meta.name)).toEqual([
      'commerce_list_my_orders',
      'bookings_list_my_bookings',
    ]);
  });

  it('excludes voice-inappropriate tools via the registry channel-kind filter', async () => {
    const tools = [tool('conv_request_human', ['voice']), tool('conv_request_callback')];
    const svc = new VoiceSelfServiceToolsService(fakeRegistry(tools), fakeConnectors([]));

    const result = await svc.list('org_1');

    expect(result.map((t) => t.meta.name)).toEqual(['conv_request_callback']);
  });

  it('only checks connector domains that are actually present in the candidate list', async () => {
    const tools = [tool('kb_search'), tool('bookings_list_my_bookings')];
    const connectors = fakeConnectors([]);
    const svc = new VoiceSelfServiceToolsService(fakeRegistry(tools), connectors);

    await svc.list('org_1');

    expect(connectors.asked).toEqual([['bookings']]);
  });

  it('treats a connector-backed tool as callable only when the channel allows it', () => {
    const svc = new VoiceSelfServiceToolsService(fakeRegistry([]), fakeConnectors([]));

    expect(svc.isCallable(tool('conv_request_callback'))).toBe(true);
    expect(svc.isCallable(tool('conv_request_human', ['voice']))).toBe(false);
    expect(svc.isCallable(tool('conv_request_human', ['email']))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  toSetupSnapshot,
  type SetupChannelDto,
  type SetupStateDto,
} from './setup-snapshot';

function dto(overrides: Partial<SetupStateDto> = {}): SetupStateDto {
  return {
    channels: [],
    conversationCount: 0,
    topicCount: 0,
    knowledgeDocumentCount: 0,
    externalMcpCallCount: 0,
    lastExternalMcpCallAt: null,
    ...overrides,
  };
}

function channel(overrides: Partial<SetupChannelDto> = {}): SetupChannelDto {
  return {
    id: 'cch_1',
    type: 'email',
    vendor: 'smtp',
    name: 'Support inbox',
    active: true,
    config: {},
    ...overrides,
  };
}

describe('toSetupSnapshot', () => {
  it('reports an unknown snapshot when the endpoint could not be read', () => {
    const snapshot = toSetupSnapshot(null);
    expect(snapshot.known).toBe(false);
    expect(snapshot.stage).toBe('active');
  });

  it('is unconfigured when no channel can accept a message', () => {
    expect(toSetupSnapshot(dto()).stage).toBe('unconfigured');
  });

  it('is listening once a channel is live but nothing has arrived', () => {
    expect(toSetupSnapshot(dto({ channels: [channel()] })).stage).toBe('listening');
  });

  it('is active as soon as one conversation has ever existed', () => {
    const snapshot = toSetupSnapshot(dto({ channels: [channel()], conversationCount: 1 }));
    expect(snapshot.stage).toBe('active');
  });

  it('stays unconfigured while a channel is inactive or awaiting credentials', () => {
    const inactive = toSetupSnapshot(dto({ channels: [channel({ active: false })] }));
    const pendingCreds = toSetupSnapshot(
      dto({ channels: [channel({ needsCredentials: true })] }),
    );
    expect(inactive.stage).toBe('unconfigured');
    expect(inactive.pendingChannels).toHaveLength(1);
    expect(pendingCreds.stage).toBe('unconfigured');
    expect(pendingCreds.pendingChannels).toHaveLength(1);
  });

  it('counts the endpoint as connected only after an external tool call is recorded', () => {
    expect(toSetupSnapshot(dto()).agentConnected).toBe(false);
    expect(toSetupSnapshot(dto({ externalMcpCallCount: 3 })).agentConnected).toBe(true);
  });

  it('labels each channel with its public address, falling back to the channel name', () => {
    const snapshot = toSetupSnapshot(
      dto({
        channels: [
          channel({
            id: 'a',
            type: 'email',
            config: { addressing: { fromAddress: 'support@uscore.no' } },
          }),
          channel({ id: 'b', type: 'chat', config: { originAllowlist: ['uscore.no'] } }),
          channel({ id: 'c', type: 'sms', config: { fromNumber: '+4740000000' } }),
          channel({ id: 'd', type: 'voice', name: 'Main line', config: {} }),
        ],
      }),
    );
    expect(snapshot.liveChannels.map((c) => c.label)).toEqual([
      'support@uscore.no',
      'uscore.no',
      '+4740000000',
      'Main line',
    ]);
  });

  it('orders channels email → chat → sms → voice regardless of how they were named', () => {
    const snapshot = toSetupSnapshot(
      dto({
        channels: [
          channel({ id: 'a', type: 'voice', name: 'Aardvark line' }),
          channel({ id: 'b', type: 'chat', name: 'Zebra widget' }),
          channel({ id: 'c', type: 'email', name: 'Middle inbox' }),
        ],
      }),
    );
    expect(snapshot.liveChannels.map((c) => c.type)).toEqual(['email', 'chat', 'voice']);
  });
});

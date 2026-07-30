import { describe, it, expect } from 'vitest';
import type { schema } from '@getmunin/db';
import { VapiOutreachCaller, type VapiOutreachClient } from '../vapi/vapi-outreach-caller.ts';
import {
  ThrellOutreachCaller,
  type ThrellOutreachClient,
} from '../threll/threll-outreach-caller.ts';
import type { PlaceOutreachCallInput } from './outreach-voice.ts';

const CONTEXT = {
  outreachCampaignId: 'ocmp_1',
  outreachProposalId: 'oprp_1',
  contactId: 'cct_1',
};

function channel(
  vendor: string,
  config: Record<string, unknown>,
): typeof schema.convChannels.$inferSelect {
  return { id: 'cch_1', orgId: 'org_1', type: 'voice', vendor, config } as never;
}

function input(
  ch: typeof schema.convChannels.$inferSelect,
  overrides: Partial<PlaceOutreachCallInput> = {},
): PlaceOutreachCallInput {
  return {
    channel: ch,
    toNumber: '+4712345678',
    customerName: 'Jane Doe',
    opening: 'Say hei, then offer Tuesday or Thursday.',
    context: CONTEXT,
    ...overrides,
  };
}

describe('VapiOutreachCaller', () => {
  const vapiChannel = channel('vapi', {
    encryptedApiKey: 'enc-key',
    encryptedWebhookSecret: 'enc-hook',
    assistantId: 'asst_1',
    phoneNumberId: 'pn_1',
  });

  function stub(): { client: VapiOutreachClient; calls: Record<string, unknown>[] } {
    const calls: Record<string, unknown>[] = [];
    return {
      calls,
      client: {
        loadSecret: (ciphertext) => Promise.resolve(`plain:${ciphertext}`),
        placeCall: (req) => {
          calls.push(req);
          return Promise.resolve({ id: 'call_vapi_1', status: 'queued' });
        },
      },
    };
  }

  it('keys its conversations on vapiCallId', () => {
    expect(new VapiOutreachCaller(stub().client).callIdMetadataKey).toBe('vapiCallId');
  });

  it('passes the draft as assistant metadata alongside the outreach ids', async () => {
    const { client, calls } = stub();
    const res = await new VapiOutreachCaller(client).placeOutreachCall(input(vapiChannel));

    expect(res).toEqual({ callId: 'call_vapi_1', status: 'queued' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      apiKey: 'plain:enc-key',
      assistantId: 'asst_1',
      phoneNumberId: 'pn_1',
      toNumber: '+4712345678',
      customer: { name: 'Jane Doe' },
      assistantOverrides: {
        metadata: { ...CONTEXT, draftOpening: 'Say hei, then offer Tuesday or Thursday.' },
      },
    });
  });

  it('refuses a channel with no phone number id rather than calling the vendor', async () => {
    const { client, calls } = stub();
    const noPhone = channel('vapi', {
      encryptedApiKey: 'enc-key',
      encryptedWebhookSecret: 'enc-hook',
      assistantId: 'asst_1',
    });
    await expect(
      new VapiOutreachCaller(client).placeOutreachCall(input(noPhone)),
    ).rejects.toThrow(/phoneNumberId/);
    expect(calls).toHaveLength(0);
  });
});

describe('ThrellOutreachCaller', () => {
  const threllChannel = channel('threll', {
    encryptedApiKey: 'enc-key',
    encryptedWebhookSecret: 'enc-hook',
    accountId: 'acct_1',
    workerId: 'wrk_1',
  });

  function stub(): { client: ThrellOutreachClient; calls: Record<string, unknown>[] } {
    const calls: Record<string, unknown>[] = [];
    return {
      calls,
      client: {
        loadSecret: (ciphertext) => Promise.resolve(`plain:${ciphertext}`),
        placeCall: (req) => {
          calls.push(req);
          return Promise.resolve({ id: 'call_threll_1', status: 'ringing' });
        },
      },
    };
  }

  it('keys its conversations on threllCallId, not vapiCallId', () => {
    expect(new ThrellOutreachCaller(stub().client).callIdMetadataKey).toBe('threllCallId');
  });

  it('passes the draft as call context, which is what Threll reads', async () => {
    const { client, calls } = stub();
    const res = await new ThrellOutreachCaller(client).placeOutreachCall(input(threllChannel));

    expect(res).toEqual({ callId: 'call_threll_1', status: 'ringing' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      apiKey: 'plain:enc-key',
      accountId: 'acct_1',
      workerId: 'wrk_1',
      toNumber: '+4712345678',
      context: 'Say hei, then offer Tuesday or Thursday.',
      customer: { firstName: 'Jane Doe' },
    });
  });

  it('omits the customer when the contact has no name', async () => {
    const { client, calls } = stub();
    await new ThrellOutreachCaller(client).placeOutreachCall(
      input(threllChannel, { customerName: undefined }),
    );
    expect(calls[0]!.customer).toBeUndefined();
  });
});

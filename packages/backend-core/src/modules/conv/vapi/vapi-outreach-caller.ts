import { Inject, Injectable } from '@nestjs/common';
import { VapiClientService } from './vapi-client.service.ts';
import { jsonbToStored } from './vapi.service.ts';
import type { OutreachVoiceCaller, PlaceOutreachCallInput } from '../channels/outreach-voice.ts';

export interface VapiOutreachClient {
  loadSecret(ciphertext: string): Promise<string>;
  placeCall(req: {
    apiKey: string;
    assistantId: string;
    phoneNumberId: string;
    toNumber: string;
    customer?: { name?: string };
    assistantOverrides?: { metadata?: Record<string, unknown> };
  }): Promise<{ id: string; status: string }>;
}

@Injectable()
export class VapiOutreachCaller implements OutreachVoiceCaller {
  readonly vendor = 'vapi';
  readonly callIdMetadataKey = 'vapiCallId';

  constructor(@Inject(VapiClientService) private readonly client: VapiOutreachClient) {}

  async placeOutreachCall(
    input: PlaceOutreachCallInput,
  ): Promise<{ callId: string; status: string }> {
    const config = jsonbToStored(input.channel.config);
    if (!config.phoneNumberId) {
      throw new Error('voice channel has no phoneNumberId — set one to place outbound PSTN calls');
    }
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    const res = await this.client.placeCall({
      apiKey,
      assistantId: config.assistantId,
      phoneNumberId: config.phoneNumberId,
      toNumber: input.toNumber,
      customer: input.customerName ? { name: input.customerName } : undefined,
      assistantOverrides: {
        metadata: { ...input.context, draftOpening: input.opening },
      },
    });
    return { callId: res.id, status: res.status };
  }
}

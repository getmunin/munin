import { Inject, Injectable } from '@nestjs/common';
import { ThrellClientService } from './threll-client.service.ts';
import { jsonbToStored } from './threll.service.ts';
import type { OutreachVoiceCaller, PlaceOutreachCallInput } from '../channels/outreach-voice.ts';

export interface ThrellOutreachClient {
  loadSecret(ciphertext: string): Promise<string>;
  placeCall(req: {
    apiKey: string;
    accountId: string;
    workerId: string;
    toNumber: string;
    context?: string;
    customer?: { firstName?: string };
  }): Promise<{ id: string; status: string }>;
}

@Injectable()
export class ThrellOutreachCaller implements OutreachVoiceCaller {
  readonly vendor = 'threll';
  readonly callIdMetadataKey = 'threllCallId';

  constructor(@Inject(ThrellClientService) private readonly client: ThrellOutreachClient) {}

  async placeOutreachCall(
    input: PlaceOutreachCallInput,
  ): Promise<{ callId: string; status: string }> {
    const config = jsonbToStored(input.channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    const res = await this.client.placeCall({
      apiKey,
      accountId: config.accountId,
      workerId: config.workerId,
      toNumber: input.toNumber,
      context: input.opening,
      customer: input.customerName ? { firstName: input.customerName } : undefined,
    });
    return { callId: res.id, status: res.status };
  }
}

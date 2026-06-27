import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { describeConfigFields } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ChannelOptionsDto,
  ConfigureChannelInput,
  ListChannelOptionsInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, VapiAdminService, type VapiListAssistantsResult } from './vapi-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

const OptionsConfig = z.object({ apiKey: z.string().min(1).max(256) });

@Injectable()
export class VapiAdminProvider implements ChannelAdminProvider {
  readonly kind = 'voice' as const;
  readonly vendor = 'vapi';
  readonly displayName = 'Vapi';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: true, sendTest: false };

  constructor(@Inject(VapiAdminService) private readonly tools: VapiAdminService) {}

  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto> {
    const config = ConfigSchema.parse(input.config);
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  test(channelId: string) {
    return this.tools.testChannel({ channelId });
  }

  call(input: { channelId: string; to: string; customerName?: string }) {
    return this.tools.callInitiate(input);
  }

  async listOptions(input: ListChannelOptionsInput): Promise<ChannelOptionsDto> {
    if (input.channelId) {
      return toChannelOptions(await this.tools.listAssistantsForChannel({ channelId: input.channelId }));
    }
    const parsed = OptionsConfig.safeParse(input.config);
    if (!parsed.success) {
      throw new BadRequestException(`invalid vapi discovery config: ${parsed.error.message}`);
    }
    return toChannelOptions(await this.tools.listAssistants(parsed.data));
  }

  onArchive(channelId: string): Promise<void> {
    return this.tools.restoreWebhook(channelId);
  }
}

function toChannelOptions(res: VapiListAssistantsResult): ChannelOptionsDto {
  return {
    groups: [
      {
        key: 'assistants',
        label: 'Assistants',
        options: res.assistants.map((a) => ({ value: a.id, label: a.name ?? a.id })),
      },
    ],
  };
}

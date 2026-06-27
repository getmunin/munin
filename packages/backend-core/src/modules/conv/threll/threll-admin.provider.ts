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
import { ConfigureInput, ThrellAdminService, type ThrellListWorkersResult } from './threll-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

const OptionsConfig = z.object({
  apiKey: z.string().min(1).max(256),
  accountId: z.string().min(1).max(128).optional(),
});

@Injectable()
export class ThrellAdminProvider implements ChannelAdminProvider {
  readonly kind = 'voice' as const;
  readonly vendor = 'threll';
  readonly displayName = 'Threll';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: true, sendTest: false };

  constructor(@Inject(ThrellAdminService) private readonly tools: ThrellAdminService) {}

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
      return toChannelOptions(await this.tools.listWorkersForChannel({ channelId: input.channelId }));
    }
    const parsed = OptionsConfig.safeParse(input.config);
    if (!parsed.success) {
      throw new BadRequestException(`invalid threll discovery config: ${parsed.error.message}`);
    }
    return toChannelOptions(await this.tools.listWorkers(parsed.data));
  }
}

function toChannelOptions(res: ThrellListWorkersResult): ChannelOptionsDto {
  return {
    context: res.account ? { label: res.account.name ?? res.account.id } : undefined,
    groups: [
      {
        key: 'workers',
        label: 'Workers',
        options: res.workers.map((w) => ({
          value: w.id,
          label: w.name ?? w.id,
          hint: w.inboundPhoneNumber ?? w.outboundPhoneNumber ?? undefined,
        })),
      },
    ],
  };
}

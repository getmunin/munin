import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { describeConfigFields, parseVendorConfig } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ChannelOptionsDto,
  ConfigureChannelInput,
  ListChannelOptionsInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, ThrellAdminService, type ThrellListWorkersResult } from './threll-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

const PendingConfig = z.object({
  workerId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128).optional(),
  replaceWebhook: z.boolean().optional(),
});

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
    const config = parseVendorConfig(ConfigSchema, input.config, 'threll');
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  validatePendingConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = PendingConfig.safeParse(config);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`conv_invalid: config for threll: ${detail}`);
    }
    return parsed.data;
  }

  completeSetup(channelId: string, secrets: Record<string, string>) {
    return this.tools.completeSetup(channelId, secrets);
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

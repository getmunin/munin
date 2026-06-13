import { Inject, Injectable } from '@nestjs/common';
import { describeConfigFields } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, VapiAdminTools } from './vapi.tools.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

@Injectable()
export class VapiAdminProvider implements ChannelAdminProvider {
  readonly kind = 'voice' as const;
  readonly vendor = 'vapi';
  readonly displayName = 'Vapi';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: true, sendTest: false };

  constructor(@Inject(VapiAdminTools) private readonly tools: VapiAdminTools) {}

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
}

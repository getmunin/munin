import { Inject, Injectable } from '@nestjs/common';
import { describeConfigFields } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, MessageBirdSmsAdminTools } from './messagebird-sms.tools.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

@Injectable()
export class MessageBirdSmsAdminProvider implements ChannelAdminProvider {
  readonly kind = 'sms' as const;
  readonly vendor = 'messagebird';
  readonly displayName = 'MessageBird SMS';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: false, sendTest: true };

  constructor(@Inject(MessageBirdSmsAdminTools) private readonly tools: MessageBirdSmsAdminTools) {}

  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto> {
    const config = ConfigSchema.parse(input.config);
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  test(channelId: string) {
    return this.tools.testChannel({ channelId });
  }

  sendTest(input: { channelId: string; to: string; body?: string }) {
    return this.tools.sendTest(input);
  }
}

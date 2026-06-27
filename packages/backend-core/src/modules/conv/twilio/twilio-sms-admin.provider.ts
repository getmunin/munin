import { Inject, Injectable } from '@nestjs/common';
import { describeConfigFields } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, TwilioSmsAdminService } from './twilio-sms-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

@Injectable()
export class TwilioSmsAdminProvider implements ChannelAdminProvider {
  readonly kind = 'sms' as const;
  readonly vendor = 'twilio';
  readonly displayName = 'Twilio SMS';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: false, sendTest: true };

  constructor(@Inject(TwilioSmsAdminService) private readonly tools: TwilioSmsAdminService) {}

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

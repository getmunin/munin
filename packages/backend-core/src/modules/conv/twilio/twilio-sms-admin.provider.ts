import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { describeConfigFields, parseVendorConfig } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, TwilioSmsAdminService } from './twilio-sms-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

const PendingConfig = z
  .object({
    accountSid: z.string().min(2).max(64),
    fromNumber: z.string().min(2).max(32).optional(),
    messagingServiceSid: z.string().min(2).max(64).optional(),
  })
  .refine((v) => Boolean(v.fromNumber || v.messagingServiceSid), {
    message: 'either fromNumber or messagingServiceSid is required',
  });

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
    const config = parseVendorConfig(ConfigSchema, input.config, 'twilio');
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  validatePendingConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = PendingConfig.safeParse(config);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`conv_invalid: config for twilio: ${detail}`);
    }
    return parsed.data;
  }

  completeSetup(channelId: string, secrets: Record<string, string>) {
    return this.tools.completeSetup(channelId, secrets);
  }

  test(channelId: string) {
    return this.tools.testChannel({ channelId });
  }

  sendTest(input: { channelId: string; to: string; body?: string }) {
    return this.tools.sendTest(input);
  }
}

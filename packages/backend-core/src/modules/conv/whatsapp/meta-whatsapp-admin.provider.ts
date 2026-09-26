import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { describeConfigFields, parseVendorConfig } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ChannelSendTestInput,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, MetaWhatsAppAdminService } from './meta-whatsapp-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true, defaultAgentMode: true });

const PendingConfig = z.object({
  wabaId: z.string().min(1).max(64),
  phoneNumberId: z.string().min(1).max(64),
  graphApiVersion: z
    .string()
    .regex(/^v\d{1,3}\.\d{1,2}$/)
    .optional(),
});

@Injectable()
export class MetaWhatsAppAdminProvider implements ChannelAdminProvider {
  readonly kind = 'whatsapp' as const;
  readonly vendor = 'meta';
  readonly displayName = 'WhatsApp (Meta Cloud API)';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: false, sendTest: true };

  constructor(@Inject(MetaWhatsAppAdminService) private readonly tools: MetaWhatsAppAdminService) {}

  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto> {
    const config = parseVendorConfig(ConfigSchema, input.config, 'meta');
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  validatePendingConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = PendingConfig.safeParse(config);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`conv_invalid: config for meta: ${detail}`);
    }
    return parsed.data;
  }

  completeSetup(channelId: string, secrets: Record<string, string>) {
    return this.tools.completeSetup(channelId, secrets);
  }

  test(channelId: string) {
    return this.tools.testChannel({ channelId });
  }

  sendTest(input: ChannelSendTestInput) {
    return this.tools.sendTest(input);
  }
}

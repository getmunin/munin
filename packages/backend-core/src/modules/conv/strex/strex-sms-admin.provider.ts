import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { STREX_KEYWORD, STREX_SHORT_NUMBER_ID, StrexEnvironmentSchema } from '@getmunin/types';
import { describeConfigFields, parseVendorConfig } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, StrexSmsAdminService } from './strex-sms-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

const PendingConfig = z.object({
  sender: z.string().min(1).max(15),
  shortNumberId: z.string().regex(STREX_SHORT_NUMBER_ID).optional(),
  keyword: z.string().regex(STREX_KEYWORD).optional(),
  environment: StrexEnvironmentSchema.optional(),
});

@Injectable()
export class StrexSmsAdminProvider implements ChannelAdminProvider {
  readonly kind = 'sms' as const;
  readonly vendor = 'strex';
  readonly displayName = 'Strex SMS';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: false, sendTest: true };

  constructor(@Inject(StrexSmsAdminService) private readonly tools: StrexSmsAdminService) {}

  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto> {
    const config = parseVendorConfig(ConfigSchema, input.config, 'strex');
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  validatePendingConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = PendingConfig.safeParse(config);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`conv_invalid: config for strex: ${detail}`);
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

  onArchive(channelId: string): Promise<void> {
    return this.tools.onArchive(channelId);
  }
}

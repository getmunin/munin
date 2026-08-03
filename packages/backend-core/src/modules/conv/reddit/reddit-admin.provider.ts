import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { RedditUsernameSchema, SendLimitsSchema } from '@getmunin/types';
import { describeConfigFields } from '../channels/channel-admin.ts';
import type {
  ChannelAdminDto,
  ChannelAdminProvider,
  ConfigureChannelInput,
} from '../channels/channel-admin.ts';
import { ConfigureInput, RedditAdminService } from './reddit-admin.service.ts';

const ConfigSchema = ConfigureInput.omit({ channelId: true, name: true });

const PendingConfig = z.object({
  clientId: z.string().min(1).max(128),
  username: RedditUsernameSchema,
  sendLimits: SendLimitsSchema.optional(),
});

@Injectable()
export class RedditAdminProvider implements ChannelAdminProvider {
  readonly kind = 'chat' as const;
  readonly vendor = 'reddit';
  readonly displayName = 'Reddit';
  readonly configInput = ConfigSchema;
  readonly configFields = describeConfigFields(ConfigSchema);
  readonly capabilities = { call: false, sendTest: true };

  constructor(@Inject(RedditAdminService) private readonly tools: RedditAdminService) {}

  configure(input: ConfigureChannelInput): Promise<ChannelAdminDto> {
    const config = ConfigSchema.parse(input.config);
    return this.tools.configure({ channelId: input.channelId, name: input.name, ...config });
  }

  validatePendingConfig(config: Record<string, unknown>): Record<string, unknown> {
    const parsed = PendingConfig.safeParse(config);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestException(`conv_invalid: config for reddit: ${detail}`);
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

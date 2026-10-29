import { z } from 'zod';
import { SendPolicySchema } from './send-policy.ts';
import { OutreachInvalidError } from './outreach-errors.ts';

export const JOURNEY_DELIVERY_CHANNELS = ['email', 'sms', 'voice', 'chat'] as const;
export type JourneyDeliveryChannel = (typeof JOURNEY_DELIVERY_CHANNELS)[number];

export const JourneyDeliverySchema = z.object({
  channel: z.enum(JOURNEY_DELIVERY_CHANNELS),
  format: z.enum(['markdown', 'mjml']),
  templateId: z.string().min(1).nullable(),
  templateHash: z.string().min(1).nullable(),
  preheader: z.string().nullable(),
  policy: SendPolicySchema,
  auto: z.boolean(),
});

export type JourneyDelivery = z.infer<typeof JourneyDeliverySchema>;

export function parseJourneyDelivery(proposalId: string, raw: unknown): JourneyDelivery {
  const parsed = JourneyDeliverySchema.safeParse(raw);
  if (!parsed.success) {
    throw new OutreachInvalidError(
      `journey proposal ${proposalId} has no valid delivery settings (${parsed.error.issues
        .map((i) => `${i.path.join('.') || 'journey_delivery'}: ${i.message}`)
        .join('; ')}), so it cannot be sent`,
      'outreach_journey_invalid',
    );
  }
  return parsed.data;
}

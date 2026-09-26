import { z } from 'zod';

const Account = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(256).optional(),
    aadObjectId: z.string().max(64).optional(),
  })
  .passthrough();

export const TeamsActivitySchema = z
  .object({
    type: z.string().min(1).max(64),
    id: z.string().max(256).optional(),
    name: z.string().max(128).optional(),
    serviceUrl: z.string().min(1).max(512),
    text: z.string().max(200_000).optional(),
    from: Account.optional(),
    recipient: Account.optional(),
    conversation: z
      .object({
        id: z.string().min(1).max(512),
        conversationType: z.string().max(32).optional(),
        tenantId: z.string().max(64).optional(),
      })
      .passthrough(),
    channelData: z
      .object({
        eventType: z.string().max(64).optional(),
        tenant: z.object({ id: z.string().max(64) }).passthrough().optional(),
        team: z
          .object({ id: z.string().min(1).max(256), name: z.string().max(256).optional() })
          .passthrough()
          .optional(),
        channel: z
          .object({ id: z.string().min(1).max(256), name: z.string().max(256).optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    membersAdded: z.array(Account).max(500).optional(),
    membersRemoved: z.array(Account).max(500).optional(),
    action: z.string().max(64).optional(),
    attachments: z
      .array(z.object({ contentType: z.string().max(256) }).passthrough())
      .max(50)
      .optional(),
    value: z.unknown().optional(),
  })
  .passthrough();

export type TeamsInboundActivity = z.infer<typeof TeamsActivitySchema>;

export const CardActionValueSchema = z.object({
  action: z.object({
    type: z.string().optional(),
    verb: z.string().min(1).max(64),
    data: z.object({ conversationId: z.string().min(1).max(64) }).passthrough(),
  }),
});

export function activityTenantId(activity: TeamsInboundActivity): string | null {
  return activity.channelData?.tenant?.id ?? activity.conversation.tenantId ?? null;
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';
import { TimeWindow, WEEKDAYS, type Weekday } from '@getmunin/types';

export const SEND_RULES_SETTINGS_KEY = 'outreach.sendRules';

export interface SendRules {
  timezone: string;
  quietHours: string | null;
  validDays: Weekday[] | null;
  weeklyCap: number | null;
  cooldownHoursAfterConversation: number;
}

export interface SendRulesDto extends SendRules {
  configured: boolean;
  recommended: Omit<SendRules, 'timezone'>;
}

export const DEFAULT_SEND_RULES: SendRules = {
  timezone: 'UTC',
  quietHours: null,
  validDays: null,
  weeklyCap: null,
  cooldownHoursAfterConversation: 0,
};

export const RECOMMENDED_SEND_RULES: Omit<SendRules, 'timezone'> = {
  quietHours: '20:00-08:00',
  validDays: null,
  weeklyCap: 3,
  cooldownHoursAfterConversation: 24,
};

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const SendRulesInput = z.object({
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isKnownTimeZone, { message: 'must be an IANA time zone, e.g. "Europe/Oslo"' })
    .describe('Time zone for contacts whose own `customFields.timezone` is not set.'),
  quietHours: TimeWindow.nullable().describe('When marketing must not go out, e.g. "20:00-08:00"; null for none.'),
  validDays: z
    .array(z.enum(WEEKDAYS))
    .min(1)
    .max(7)
    .nullable()
    .describe('Weekdays marketing may go out on; null for every day.'),
  weeklyCap: z
    .number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .describe('Most marketing messages one contact receives in any 7 days; null for no cap.'),
  cooldownHoursAfterConversation: z
    .number()
    .int()
    .min(0)
    .max(720)
    .describe('Hours to wait after a contact last wrote to the team before marketing reaches them again.'),
});

export type SendRulesInputValue = z.infer<typeof SendRulesInput>;

export function parseSendRules(settings: Record<string, unknown>): SendRules {
  const raw = settings[SEND_RULES_SETTINGS_KEY];
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SEND_RULES };
  const parsed = SendRulesInput.partial().safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_SEND_RULES };
  const value = parsed.data;
  return {
    timezone: value.timezone ?? DEFAULT_SEND_RULES.timezone,
    quietHours: value.quietHours === undefined ? DEFAULT_SEND_RULES.quietHours : value.quietHours,
    validDays: value.validDays === undefined ? DEFAULT_SEND_RULES.validDays : value.validDays,
    weeklyCap: value.weeklyCap === undefined ? DEFAULT_SEND_RULES.weeklyCap : value.weeklyCap,
    cooldownHoursAfterConversation:
      value.cooldownHoursAfterConversation ?? DEFAULT_SEND_RULES.cooldownHoursAfterConversation,
  };
}

export async function readSendRules(db: Db | Tx, orgId: string): Promise<SendRulesDto> {
  const [row] = await db
    .select({ settings: schema.orgs.settings })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId))
    .limit(1);
  const settings = row?.settings ?? {};
  return {
    ...parseSendRules(settings),
    configured: SEND_RULES_SETTINGS_KEY in settings,
    recommended: RECOMMENDED_SEND_RULES,
  };
}

@Injectable()
export class OutreachSendRulesService {
  async get(): Promise<SendRulesDto> {
    const ctx = getCurrentContext();
    return readSendRules(ctx.db, ctx.actor!.orgId);
  }

  async configure(input: SendRulesInputValue): Promise<SendRulesDto> {
    const ctx = getCurrentContext();
    const parsed = SendRulesInput.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: `outreach_send_rules_invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        code: 'outreach_send_rules_invalid',
      });
    }
    const value: SendRules = {
      ...parsed.data,
      validDays: parsed.data.validDays ? [...new Set(parsed.data.validDays)] : null,
    };
    await ctx.db
      .update(schema.orgs)
      .set({
        settings: sql`${schema.orgs.settings} || ${JSON.stringify({ [SEND_RULES_SETTINGS_KEY]: value })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(schema.orgs.id, ctx.actor!.orgId));
    return { ...value, configured: true, recommended: RECOMMENDED_SEND_RULES };
  }
}

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { NATIONAL_ID_DETECTORS, type NationalIdDetector } from '@getmunin/core';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import {
  applyInboundRedaction,
  type DetectedNationalId,
  type InboundRedactionResult,
  type InboundTextFields,
} from './inbound-redaction.ts';
import { parseRedactionPolicy, readRedactionPolicy, REDACTION_SETTINGS_KEY } from './redaction-policy.ts';

export interface RedactionPolicyDto {
  detectors: NationalIdDetector[];
  policy: 'off' | 'mask' | 'remove';
  minConfidence: 'high' | 'medium';
  availableDetectors: readonly NationalIdDetector[];
}

export const DETECTED_NATIONAL_IDS_KEY = 'detectedNationalIds';

@Injectable()
export class InboundRedactionService {
  constructor(@Inject(AlertsService) private readonly alerts: AlertsService) {}

  async getPolicy(): Promise<RedactionPolicyDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const policy = await readRedactionPolicy(ctx.db, actor.orgId);
    return toDto(policy);
  }

  async configure(input: {
    detectors: NationalIdDetector[];
    policy: 'off' | 'mask' | 'remove';
    minConfidence?: 'high' | 'medium';
  }): Promise<RedactionPolicyDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const detectors = [...new Set(input.detectors)];
    if (input.policy !== 'off' && detectors.length === 0) {
      throw new BadRequestException({
        message:
          'conv_redaction_invalid: pick at least one identifier type, or set the policy to off',
        code: 'conv_redaction_invalid',
      });
    }
    const value = {
      detectors,
      policy: input.policy,
      minConfidence: input.minConfidence ?? 'high',
    };
    const [updated] = await ctx.db
      .update(schema.orgs)
      .set({
        settings: sql`${schema.orgs.settings} || ${JSON.stringify({ [REDACTION_SETTINGS_KEY]: value })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(schema.orgs.id, actor.orgId))
      .returning({ settings: schema.orgs.settings });
    return toDto(parseRedactionPolicy(updated?.settings ?? {}));
  }

  async apply<T extends InboundTextFields>(
    db: Db | Tx,
    orgId: string,
    fields: T,
  ): Promise<InboundRedactionResult<T>> {
    const policy = await readRedactionPolicy(db, orgId);
    const result = applyInboundRedaction(fields, policy);
    if (result.detected.length > 0) {
      await this.raise(result.detected, policy.policy !== 'off' && result.redacted);
    }
    return result;
  }

  private async raise(detected: DetectedNationalId[], redacted: boolean): Promise<void> {
    await this.alerts.openAlert({
      source: 'data_protection',
      severity: 'warning',
      title: redacted
        ? 'National identity numbers are arriving and being redacted'
        : 'National identity numbers are arriving in your inbox',
      detail: describe(detected, redacted),
      metadata: { detectors: detected },
      ctaHref: '/dashboard/settings/privacy',
      ctaLabelKey: 'alerts.cta.reviewRedaction',
    });
  }
}

export function stampDetections(
  metadata: Record<string, unknown>,
  detected: readonly DetectedNationalId[],
): Record<string, unknown> {
  if (detected.length === 0) return metadata;
  return { ...metadata, [DETECTED_NATIONAL_IDS_KEY]: detected };
}

function describe(detected: readonly DetectedNationalId[], redacted: boolean): string {
  const kinds = [...new Set(detected.map((d) => LABEL[d.detector]))].join(', ');
  return redacted
    ? `Inbound messages contain ${kinds}. They are being redacted before storage.`
    : `Inbound messages contain ${kinds}, and are being stored in full. Review your redaction policy.`;
}

const LABEL: Record<DetectedNationalId['detector'], string> = {
  no_fnr: 'Norwegian fødselsnummer',
  se_pnr: 'Swedish personnummer',
  dk_cpr: 'Danish CPR numbers',
};

function toDto(policy: {
  detectors: readonly NationalIdDetector[];
  policy: 'off' | 'mask' | 'remove';
  minConfidence: 'high' | 'medium';
}): RedactionPolicyDto {
  return {
    detectors: [...policy.detectors],
    policy: policy.policy,
    minConfidence: policy.minConfidence,
    availableDetectors: NATIONAL_ID_DETECTORS,
  };
}

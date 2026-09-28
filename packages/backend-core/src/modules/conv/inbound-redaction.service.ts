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
import {
  isRedactionConfigured,
  parseRedactionPolicy,
  readRedactionState,
  REDACTION_SETTINGS_KEY,
} from './redaction-policy.ts';

export interface RedactionPolicyDto {
  detectors: NationalIdDetector[];
  policy: 'off' | 'mask' | 'remove';
  minConfidence: 'high' | 'medium';
  configured: boolean;
  availableDetectors: readonly NationalIdDetector[];
}

export const DETECTED_NATIONAL_IDS_KEY = 'detectedNationalIds';

@Injectable()
export class InboundRedactionService {
  constructor(@Inject(AlertsService) private readonly alerts: AlertsService) {}

  async getPolicy(): Promise<RedactionPolicyDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const { policy, configured } = await readRedactionState(ctx.db, actor.orgId);
    return toDto(policy, configured);
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
    await this.alerts.resolveAlert({ source: 'data_protection' });
    const settings = updated?.settings ?? {};
    return toDto(parseRedactionPolicy(settings), isRedactionConfigured(settings));
  }

  async apply<T extends InboundTextFields>(
    db: Db | Tx,
    orgId: string,
    fields: T,
  ): Promise<InboundRedactionResult<T>> {
    const { policy, configured } = await readRedactionState(db, orgId);
    const result = applyInboundRedaction(fields, policy);
    if (result.detected.length > 0) {
      if (configured) await this.alerts.resolveAlert({ source: 'data_protection' });
      else await this.raise(result.detected);
    }
    return result;
  }

  private async raise(detected: DetectedNationalId[]): Promise<void> {
    await this.alerts.openAlert({
      source: 'data_protection',
      severity: 'warning',
      title: 'National identity numbers are arriving in your inbox',
      detail: describe(detected),
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

function describe(detected: readonly DetectedNationalId[]): string {
  const kinds = [...new Set(detected.map((d) => LABEL[d.detector]))].join(', ');
  return `Inbound messages contain ${kinds}, and are being stored in full. Choose whether to redact them or keep them.`;
}

const LABEL: Record<DetectedNationalId['detector'], string> = {
  no_fnr: 'Norwegian fødselsnummer',
  se_pnr: 'Swedish personnummer',
  dk_cpr: 'Danish CPR numbers',
};

function toDto(
  policy: {
    detectors: readonly NationalIdDetector[];
    policy: 'off' | 'mask' | 'remove';
    minConfidence: 'high' | 'medium';
  },
  configured: boolean,
): RedactionPolicyDto {
  return {
    detectors: [...policy.detectors],
    policy: policy.policy,
    minConfidence: policy.minConfidence,
    configured,
    availableDetectors: NATIONAL_ID_DETECTORS,
  };
}

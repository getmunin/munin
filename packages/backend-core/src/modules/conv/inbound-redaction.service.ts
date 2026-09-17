import { Inject, Injectable } from '@nestjs/common';
import type { Db, Tx } from '@getmunin/db';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import {
  applyInboundRedaction,
  type DetectedNationalId,
  type InboundRedactionResult,
  type InboundTextFields,
} from './inbound-redaction.ts';
import { readRedactionPolicy } from './redaction-policy.ts';

export const DETECTED_NATIONAL_IDS_KEY = 'detectedNationalIds';

@Injectable()
export class InboundRedactionService {
  constructor(@Inject(AlertsService) private readonly alerts: AlertsService) {}

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

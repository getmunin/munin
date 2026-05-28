import { Inject, Injectable, Logger } from '@nestjs/common';
import { signHmac } from '@getmunin/core';
import { InstanceIdService } from './instance-id.service.ts';

const DEFAULT_INTAKE_URL = 'https://feedback.getmunin.com/v1/public/feedback';
const HMAC_KEY_CONSTANT = 'munin-feedback-intake-v1';

export interface ForwardPayload {
  title: string;
  body: string;
  appScope?: string | null;
  attribution?: { orgName?: string; userName?: string } | null;
}

export interface ForwardResult {
  ok: boolean;
  permanent: boolean;
  status: number;
  error?: string;
}

@Injectable()
export class FeedbackForwarder {
  private readonly logger = new Logger(FeedbackForwarder.name);

  constructor(
    @Inject(InstanceIdService) private readonly instanceId: InstanceIdService,
  ) {}

  async forward(input: ForwardPayload): Promise<ForwardResult> {
    const intakeUrl = process.env.MUNIN_FEEDBACK_INTAKE_URL ?? DEFAULT_INTAKE_URL;
    const instanceId = await this.instanceId.get();
    const body = canonicalBody({
      title: input.title,
      body: input.body,
      appScope: input.appScope ?? null,
      attribution: input.attribution ?? null,
      instanceId,
      submittedAt: new Date().toISOString(),
    });
    const key = signHmac(instanceId, HMAC_KEY_CONSTANT);
    const signature = `v1=${signHmac(body, key)}`;

    try {
      const res = await fetch(intakeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-munin-signature': signature,
        },
        body,
      });
      if (res.ok) return { ok: true, permanent: false, status: res.status };
      const errText = await res.text().catch(() => '');
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      return {
        ok: false,
        permanent,
        status: res.status,
        error: errText.slice(0, 300),
      };
    } catch (err) {
      this.logger.warn('feedback forward network error', err);
      return {
        ok: false,
        permanent: false,
        status: 0,
        error: err instanceof Error ? err.message : 'network_error',
      };
    }
  }
}

function canonicalBody(p: {
  title: string;
  body: string;
  appScope: string | null;
  attribution: { orgName?: string; userName?: string } | null;
  instanceId: string;
  submittedAt: string;
}): string {
  return JSON.stringify({
    title: p.title,
    body: p.body,
    appScope: p.appScope,
    attribution: p.attribution,
    instanceId: p.instanceId,
    submittedAt: p.submittedAt,
  });
}

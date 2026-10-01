import { affectsProviderHealth, type SkillPassResult } from '@getmunin/agent-runtime';

type FailedSkillPass = Extract<SkillPassResult, { ok: false }>;

const NON_RETRYABLE_SKIPS: ReadonlySet<FailedSkillPass['skipped']> = new Set([
  'skill_missing',
  'no_tool_allowlist',
  'no_admin_key',
  'no_provider_key',
  'quota_exceeded',
]);

export interface CuratorFailureDisposition {
  retryable: boolean;
  providerHealthFailure: boolean;
}

export function curatorFailureDisposition(result: FailedSkillPass): CuratorFailureDisposition {
  const providerHealthFailure =
    result.skipped === 'provider_error' &&
    (result.code === undefined || affectsProviderHealth(result.code));
  const retryable =
    !NON_RETRYABLE_SKIPS.has(result.skipped) && result.code !== 'provider_context_length';
  return { retryable, providerHealthFailure };
}

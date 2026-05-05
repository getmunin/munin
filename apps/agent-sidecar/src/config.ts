import { z } from 'zod';
import { defaultPromptsDir } from '@getmunin/agent-runtime';

const ConfigSchema = z.object({
  muninBaseUrl: z.string().url(),
  muninAdminApiKey: z.string().min(1),
  providerBaseUrl: z.string().url(),
  providerApiKey: z.string().min(1),
  model: z.string().min(1),
  debounceMs: z.number().int().nonnegative(),
  maxToolIterations: z.number().int().positive(),
  maxHistoryChars: z.number().int().positive(),
  promptsDir: z.string().min(1),
  curatorsDisabled: z.boolean(),
  kbCurationOnHandover: z.boolean(),
});

export type SidecarConfig = z.infer<typeof ConfigSchema>;

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SidecarConfig {
  const parsed = ConfigSchema.safeParse({
    muninBaseUrl: env.MUNIN_BASE_URL ?? 'http://localhost:3001',
    muninAdminApiKey: env.MUNIN_ADMIN_API_KEY ?? '',
    providerBaseUrl: pick(
      env.MUNIN_SIDECAR_PROVIDER_BASE_URL,
      env.SELF_SERVICE_AI_PROVIDER_BASE_URL,
      'https://openrouter.ai/api/v1',
    ),
    providerApiKey: pick(
      env.MUNIN_SIDECAR_PROVIDER_API_KEY,
      env.SELF_SERVICE_AI_PROVIDER_API_KEY,
      '',
    ),
    model: pick(
      env.MUNIN_SIDECAR_MODEL,
      env.SELF_SERVICE_AI_MODEL,
      'anthropic/claude-haiku-4.5',
    ),
    debounceMs: parseIntOr(
      env.MUNIN_SIDECAR_DEBOUNCE_MS ?? env.SELF_SERVICE_AI_DEBOUNCE_MS,
      500,
    ),
    maxToolIterations: parseIntOr(
      env.MUNIN_SIDECAR_MAX_TOOL_ITERATIONS ?? env.SELF_SERVICE_AI_MAX_TOOL_ITERATIONS,
      8,
    ),
    maxHistoryChars: parseIntOr(
      env.MUNIN_SIDECAR_MAX_HISTORY_CHARS ?? env.SELF_SERVICE_AI_MAX_HISTORY_CHARS,
      32_000,
    ),
    promptsDir: pick(
      env.MUNIN_SIDECAR_PROMPTS_DIR,
      env.SELF_SERVICE_AI_PROMPTS_DIR,
      defaultPromptsDir(),
    ),
    curatorsDisabled: parseBool(env.MUNIN_SIDECAR_CURATORS_DISABLED, false),
    kbCurationOnHandover: parseBool(env.MUNIN_SIDECAR_KB_CURATION_ON_HANDOVER, true),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

function pick(...candidates: (string | undefined)[]): string {
  for (const c of candidates) if (c !== undefined && c !== null && c !== '') return c;
  return candidates[candidates.length - 1] ?? '';
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  return fallback;
}

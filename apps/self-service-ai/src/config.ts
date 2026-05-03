import { z } from 'zod';

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
});

export type SidecarConfig = z.infer<typeof ConfigSchema>;

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SidecarConfig {
  const parsed = ConfigSchema.safeParse({
    muninBaseUrl: env.MUNIN_BASE_URL ?? 'http://localhost:3001',
    muninAdminApiKey: env.MUNIN_ADMIN_API_KEY ?? '',
    providerBaseUrl:
      env.SELF_SERVICE_AI_PROVIDER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    providerApiKey: env.SELF_SERVICE_AI_PROVIDER_API_KEY ?? '',
    model: env.SELF_SERVICE_AI_MODEL ?? 'anthropic/claude-haiku-4.5',
    debounceMs: parseIntOr(env.SELF_SERVICE_AI_DEBOUNCE_MS, 500),
    maxToolIterations: parseIntOr(env.SELF_SERVICE_AI_MAX_TOOL_ITERATIONS, 8),
    maxHistoryChars: parseIntOr(env.SELF_SERVICE_AI_MAX_HISTORY_CHARS, 32_000),
    promptsDir: env.SELF_SERVICE_AI_PROMPTS_DIR ?? defaultPromptsDir(),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function defaultPromptsDir(): string {
  const here = new URL('.', import.meta.url).pathname;
  return new URL('../prompts/', `file://${here}`).pathname;
}

import { z } from 'zod';

const ConfigSchema = z.object({
  muninBaseUrl: z.string().url(),
  muninAdminApiKey: z.string().min(1),
  providerBaseUrl: z.string().url(),
  providerApiKey: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  debounceMs: z.number().int().nonnegative(),
  maxToolIterations: z.number().int().positive(),
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
    systemPrompt:
      env.SELF_SERVICE_AI_SYSTEM_PROMPT ??
      'You are a helpful self-service assistant. Use the available tools to look up accurate information from the knowledge base and the caller\'s CRM record before answering. If you cannot answer confidently, request a human handover.',
    debounceMs: parseIntOr(env.SELF_SERVICE_AI_DEBOUNCE_MS, 500),
    maxToolIterations: parseIntOr(env.SELF_SERVICE_AI_MAX_TOOL_ITERATIONS, 8),
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

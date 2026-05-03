/**
 * Per-channel prompt descriptors. Appended to the deployment's base
 * system prompt so the LLM can adapt tone/format to the channel kind.
 *
 * Built-in defaults cover the four ChannelKind values today
 * (email | chat | sms | voice). Each can be overridden per deployment via
 * env var (`SELF_SERVICE_AI_PROMPT_<KIND>`); the cloud addon reads the
 * same shape from `org_agent_configs.channel_prompts` instead of env.
 */

export const BUILT_IN_CHANNEL_PROMPTS: Readonly<Record<string, string>> = {
  email:
    'This conversation arrived via email. Format your reply as a complete email response: include a brief greeting, full sentences and paragraphs, and a short signoff. Quote or paraphrase prior messages where it aids clarity.',
  chat:
    'This conversation arrived via a live chat widget. Keep replies short and conversational — one or two sentences when possible. No greetings or signoffs.',
  sms:
    'This conversation arrived via SMS. Keep replies under 160 characters. No greetings or signoffs. Plain text only — no markdown, lists, or links unless the user asked for one.',
  voice:
    'This conversation arrived via a voice channel; your reply will be read aloud. Use short, natural-spoken sentences. Avoid lists, code, markdown, URLs, or any other text that does not read well as speech.',
};

/**
 * Returns the descriptor to append for the given channel kind.
 * Lookup order: caller-provided override → built-in default → caller's
 * `default` override → empty string (no descriptor appended).
 */
export function resolveChannelDescriptor(
  kind: string | undefined,
  overrides: Readonly<Record<string, string>>,
): string {
  if (kind && overrides[kind]) return overrides[kind];
  if (kind && BUILT_IN_CHANNEL_PROMPTS[kind]) return BUILT_IN_CHANNEL_PROMPTS[kind];
  if (overrides['default']) return overrides['default'];
  return '';
}

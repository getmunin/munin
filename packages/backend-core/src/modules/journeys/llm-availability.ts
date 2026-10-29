export const LLM_AVAILABILITY = Symbol('LLM_AVAILABILITY');

export interface LlmAvailability {
  providerConfigured(): Promise<boolean>;
}

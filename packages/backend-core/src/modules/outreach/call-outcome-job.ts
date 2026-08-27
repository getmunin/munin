import type { ExtractionField } from './outreach.service.ts';

function describeField(field: ExtractionField): string {
  const parts = [`- ${field.key} (${field.type}): ${field.description}`];
  if (field.options?.length) {
    parts.push(`One of exactly: ${field.options.join(' | ')}.`);
  }
  if (field.tagPrefix) {
    parts.push(`Also mirror as a tag prefixed "${field.tagPrefix}-".`);
  }
  return parts.join(' ');
}

export function buildCallOutcomePrompt(input: {
  conversationId: string;
  campaignId: string;
  contactId: string;
  extractionSchema: ExtractionField[];
}): string {
  return (
    `Run a call-outcome extraction pass for conversation ${input.conversationId} ` +
    `(campaign ${input.campaignId}, contact ${input.contactId}). ` +
    `Follow skill://outreach/extract-call-outcome exactly. ` +
    `Read the call with conv_get_conversation(${input.conversationId}), then write what the ` +
    `prospect actually said onto contact ${input.contactId} in one crm_update_contact call. ` +
    `Omit any field they did not answer — never infer or guess a value.\n\n` +
    `Fields declared by this campaign:\n` +
    input.extractionSchema.map(describeField).join('\n')
  );
}

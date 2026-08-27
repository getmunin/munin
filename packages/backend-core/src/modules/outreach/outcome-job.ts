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

function describeTrigger(channelType: string): string {
  if (channelType === 'voice') {
    return 'An outbound call on this campaign has ended; read the transcript.';
  }
  return `The prospect replied on ${channelType}; read the latest inbound message as the answer and the thread before it as context. Earlier passes may already have written fields on this contact — a newer answer supersedes an older one, and a field they did not mention this time keeps its stored value.`;
}

export function buildOutcomePrompt(input: {
  conversationId: string;
  campaignId: string;
  contactId: string;
  channelType: string;
  extractionSchema: ExtractionField[];
}): string {
  return (
    `Run an outreach outcome-extraction pass for conversation ${input.conversationId} ` +
    `(campaign ${input.campaignId}, contact ${input.contactId}, channel ${input.channelType}). ` +
    `${describeTrigger(input.channelType)} ` +
    `Follow skill://outreach/extract-outcome exactly. ` +
    `Read the conversation with conv_get_conversation(${input.conversationId}), then write what the ` +
    `prospect actually said onto contact ${input.contactId} in one crm_update_contact call. ` +
    `Omit any field they did not answer — never infer or guess a value.\n\n` +
    `Fields declared by this campaign:\n` +
    input.extractionSchema.map(describeField).join('\n')
  );
}

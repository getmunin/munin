export function buildGapCurationPrompt(conversationId: string): string {
  return (
    `Run a KB curation pass for conversation ${conversationId}. ` +
    `Follow the skill exactly. Gap mode: a human answered a question the agent could not, so skip ` +
    `the conv_list_conversations step and go straight to conv_get_conversation(${conversationId}). ` +
    `Extract the (end-user question, human-reply) pair, apply the skip rules, and file via ` +
    `kb_propose_curation_candidate if it's worth keeping.`
  );
}

export function buildDeltaCurationPrompt(input: {
  conversationId: string;
  draftMessageId: string;
  sentMessageId: string;
  retrievedDocumentIds: string[];
}): string {
  const retrieved =
    input.retrievedDocumentIds.length > 0
      ? `The agent drafted from these KB documents: ${input.retrievedDocumentIds.join(', ')}. `
      : `The drafting agent recorded no KB documents for this reply. `;
  return (
    `Run a KB curation pass for conversation ${input.conversationId}. ` +
    `Follow the skill exactly. Delta mode: the agent drafted a reply and a human changed it before ` +
    `sending, so the change is the signal — not the reply. Call ` +
    `conv_get_conversation(${input.conversationId}) and compare the internal draft message ` +
    `${input.draftMessageId} against the sent message ${input.sentMessageId}. ${retrieved}` +
    `Classify the difference. If it is only formatting, tone, greeting, signature or ` +
    `personalisation, file nothing and stop. If it corrects a fact, revise the retrieved document ` +
    `that carried the wrong fact via kb_propose_curation_revision. If it answers something no ` +
    `retrieved document covers, file a new candidate instead.`
  );
}

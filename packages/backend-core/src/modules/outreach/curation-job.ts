export function buildProposalDeltaCurationPrompt(input: {
  proposalId: string;
  campaignName: string;
}): string {
  return (
    `Run a KB curation pass for outreach proposal ${input.proposalId} on campaign ` +
    `"${input.campaignName}". Follow skill://kb/review-content exactly. Delta mode: the curator ` +
    `drafted this outbound message and a human edited it before approving, so the edit is the ` +
    `signal — not the message. Call outreach_get_proposal(${input.proposalId}) and compare ` +
    `originalDraftBody (what the curator wrote) against draftBody (what the human approved). Outbound ` +
    `copy is edited mostly for tone, length and personalisation, so expect to file nothing: stop ` +
    `unless the human corrected a fact about the product or the company. If they did, search the ` +
    `KB for the document carrying that fact and propose a revision to it.`
  );
}

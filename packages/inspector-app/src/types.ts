import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ProposalContact {
  id: string;
  name: string | null;
  email: string | null;
}

export interface ProposalCampaign {
  id: string;
  name: string;
}

export interface Proposal {
  id: string;
  campaignId: string;
  contactId: string;
  conversationId: string | null;
  kind: 'initial' | 'reply';
  draftSubject: string | null;
  draftBody: string;
  evidence: Record<string, unknown>;
  proposedSendAt: string | null;
  status: 'pending' | 'approved' | 'sent' | 'failed' | 'dismissed';
  decidedAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  dismissReason: string | null;
  createdAt: string;
  contact: ProposalContact | null;
  campaign: ProposalCampaign | null;
}

export function parseToolResult(result: CallToolResult): unknown {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function errorText(result: CallToolResult): string {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  return typeof text === 'string' ? text : 'Tool call failed.';
}

export function isProposal(value: unknown): value is Proposal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'draftBody' in value &&
    'campaignId' in value &&
    'status' in value
  );
}

export function isProposalList(value: unknown): value is Proposal[] {
  return Array.isArray(value) && (value.length === 0 || isProposal(value[0]));
}

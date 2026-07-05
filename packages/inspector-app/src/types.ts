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

export interface MergeContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  endUserId: string | null;
}

export interface MergeProposal {
  id: string;
  contactA: MergeContact;
  contactB: MergeContact;
  confidence: 'high' | 'medium';
  evidence: Record<string, unknown>;
  recommendedKeeperId: string;
  recommendedPatch: Record<string, unknown>;
  status: 'pending' | 'applied' | 'dismissed';
  dismissReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurationCandidate {
  id: string;
  spaceId: string;
  slug: string | null;
  title: string;
  audiences: string[];
  version: number;
  tags: string[];
  updatedAt: string;
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
}

export interface KbDocument {
  id: string;
  spaceId: string;
  slug: string | null;
  title: string;
  body: string;
  audiences: string[];
  version: number;
  tags: string[];
  updatedAt: string;
}

export interface KbSpace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface DayPoint {
  day: string;
  views: number;
  visitors: number;
}

export interface TrafficSourceRow {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  views: number;
  visitors: number;
}

export interface FunnelStep {
  index: number;
  label: string;
  actors: number;
  conversionFromPrev: number | null;
  dropFromPrev: number | null;
}

export interface Funnel {
  sinceDays: number;
  steps: FunnelStep[];
}

export interface JourneyEvent {
  kind: 'view' | 'search';
  at: string;
  subjectType: string | null;
  subjectId: string | null;
  path: string | null;
  query: string | null;
}

export interface CmsAssetSummary {
  id: string;
  publicUrl: string;
  altText: string | null;
  mime: string;
  sizeBytes: number;
}

export interface CmsEntry {
  id: string;
  collectionId: string;
  collectionSlug: string;
  slug: string;
  locale: string;
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  data: Record<string, unknown>;
  assets?: Record<string, CmsAssetSummary>;
  version: number;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CmsAsset {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  publicUrl: string;
  altText: string | null;
  uploaded: boolean;
  createdAt: string;
}

export interface AssetUsageRow {
  fromEntryId: string;
  fieldName: string;
  kind: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isProposal(value: unknown): value is Proposal {
  return isRecord(value) && 'draftBody' in value && 'campaignId' in value && 'status' in value;
}

export function isProposalList(value: unknown): value is Proposal[] {
  return Array.isArray(value) && value.length > 0 && isProposal(value[0]);
}

export function isMergeProposal(value: unknown): value is MergeProposal {
  return (
    isRecord(value) && 'contactA' in value && 'contactB' in value && 'recommendedKeeperId' in value
  );
}

export function isMergeProposalList(value: unknown): value is MergeProposal[] {
  return Array.isArray(value) && value.length > 0 && isMergeProposal(value[0]);
}

export function isCurationCandidate(value: unknown): value is CurationCandidate {
  return isRecord(value) && 'proposedTargetSpaceSlug' in value && 'title' in value;
}

export function isCurationCandidateList(value: unknown): value is CurationCandidate[] {
  return Array.isArray(value) && value.length > 0 && isCurationCandidate(value[0]);
}

export function isKbDocument(value: unknown): value is KbDocument {
  return isRecord(value) && 'body' in value && 'spaceId' in value && 'title' in value;
}

export function isKbSpaceList(value: unknown): value is KbSpace[] {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) && 'slug' in first && 'name' in first && !('title' in first);
}

export function isDayPointList(value: unknown): value is DayPoint[] {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) && typeof first.day === 'string' && typeof first.views === 'number';
}

export function isTrafficSourceList(value: unknown): value is TrafficSourceRow[] {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) && 'utmSource' in first && typeof first.views === 'number';
}

export function isFunnel(value: unknown): value is Funnel {
  if (!isRecord(value) || !('sinceDays' in value) || !Array.isArray(value.steps)) return false;
  const first: unknown = value.steps[0];
  return isRecord(first) && typeof first.actors === 'number' && typeof first.label === 'string';
}

export function isJourneyList(value: unknown): value is JourneyEvent[] {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) && (first.kind === 'view' || first.kind === 'search') && 'at' in first;
}

export function isCmsEntry(value: unknown): value is CmsEntry {
  return (
    isRecord(value) &&
    'collectionSlug' in value &&
    'data' in value &&
    'status' in value &&
    'version' in value
  );
}

export function isCmsAssetList(value: unknown): value is CmsAsset[] {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) && 'mime' in first && 'publicUrl' in first;
}

export function isAssetUsageList(value: unknown): value is AssetUsageRow[] {
  return (
    Array.isArray(value) &&
    value.every((row) => isRecord(row) && 'fromEntryId' in row && 'fieldName' in row)
  );
}

export function isEmptyList(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

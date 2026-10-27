export type JourneyStatus = 'draft' | 'live' | 'paused' | 'archived';
export type EnrollmentState = 'active' | 'waiting' | 'done' | 'exited';

export interface JourneyIssue {
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
}

export interface JourneyValidation {
  valid: boolean;
  errors: JourneyIssue[];
  warnings: JourneyIssue[];
}

export interface JourneyVersionDto {
  number: number;
  parentVersion: number | null;
  changeSummary: string | null;
  spec: Record<string, unknown>;
  specHash: string;
  validation: JourneyValidation | null;
  createdBy: { type: string; id: string };
  publishRequestedAt: string | null;
  publishedAt: string | null;
  publishedByActorId: string | null;
  createdAt: string;
}

export type JourneyVersionSummaryDto = Omit<JourneyVersionDto, 'spec'>;

export interface JourneyDto {
  id: string;
  name: string;
  description: string | null;
  outreachCampaignId: string;
  status: JourneyStatus;
  liveVersion: number | null;
  draftVersion: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface JourneyDetailDto extends JourneyDto {
  draft: JourneyVersionDto | null;
  live: JourneyVersionDto | null;
}

export interface EnrollmentDto {
  id: string;
  journeyId: string;
  version: number;
  contactId: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  endUserId: string | null;
  state: EnrollmentState;
  currentNode: string | null;
  holdout: boolean;
  enteredAt: string;
  nextRunAt: string | null;
  goalReachedAt: string | null;
  exitedAt: string | null;
  exitReason: string | null;
}

export interface StepRunDto {
  nodeId: string;
  nodeType: string;
  visit: number;
  attempt: number;
  status: string;
  edgeTaken: string | null;
  reason: string | null;
  output: Record<string, unknown>;
  proposalId: string | null;
  agent?: { jobId: string; status: string; totalTokens: number | null; tier: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TraceDto {
  enrollment: EnrollmentDto;
  context: Record<string, unknown>;
  steps: StepRunDto[];
  openWaits: { kind: string; wakeAt: string | null; eventKey: string | null; timeoutAt: string | null }[];
}

export interface JourneyReportDto {
  journeyId: string;
  version: number | null;
  enrollments: { total: number; byState: Record<string, number>; exitReasons: Record<string, number> };
  goal: {
    treated: { entered: number; converted: number; rate: number | null };
    holdout: { entered: number; converted: number; rate: number | null };
    lift: number | null;
  };
  nodes: { nodeId: string; nodeType: string; arrived: number; waitingNow: number; failed: number; edges: Record<string, number> }[];
  messages: Record<string, Record<string, number>>;
  integrity: { duplicateSends: number; enrollmentsWithoutTrace: number };
}

export interface SimulationDto {
  sample: { source: string; segmentId: string | null; size: number };
  entered: number;
  excluded: Record<string, number>;
  arrivals: Record<string, number>;
  edges: Record<string, number>;
  exits: Record<string, number>;
  messages: {
    nodeId: string;
    contactId: string;
    contactName: string | null;
    channel?: 'email' | 'sms';
    subject: string | null;
    body?: string;
    decision: string;
    reason: string | null;
    html?: string;
  }[];
  messageDecisions: Record<string, Record<string, number>>;
  assumptions: { code: string; nodeId: string; event?: string; timeout?: string }[];
}

export interface NodeReviewStatsDto {
  nodeId: string;
  approvedUnedited: number;
  edited: number;
  dismissed: number;
  pending: number;
  sentWithoutReview: number;
  reviewed: number;
  uneditedRate: number | null;
  readyForAuto: boolean;
}

export interface PublishRequestDto {
  journeyId: string;
  version: number;
  fingerprint: string;
  diff: {
    againstVersion: number | null;
    addedNodes: string[];
    removedNodes: string[];
    changedNodes: string[];
    changedBlocks: string[];
    autoNodes: string[];
  };
  validation: JourneyValidation;
  simulation: SimulationDto;
  reviewStats: NodeReviewStatsDto[];
  reviewPath: string;
}

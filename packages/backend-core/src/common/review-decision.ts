import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export type ReviewDecisionOutcome = 'approved' | 'dismissed' | 'failed';

export interface ReviewDecisionActor {
  actorType: 'user' | 'agent';
  actorId: string;
  name: string | null;
}

export type ReviewProducedRefType = 'kb_document' | 'cms_entry' | 'crm_contact' | 'conv_message';

export interface ReviewProducedRef {
  type: ReviewProducedRefType;
  id: string;
}

export interface DecidedCursor {
  decidedAt: string;
  id: string;
}

export interface DecidedQuery {
  cursor?: DecidedCursor;
  limit?: number;
}

export interface ReviewDecision<Raw> {
  id: string;
  decidedAt: string;
  outcome: ReviewDecisionOutcome;
  reason: string | null;
  decidedBy: ReviewDecisionActor;
  producedRef: ReviewProducedRef | null;
  raw: Raw;
}

export function decidedBefore(
  decidedAt: PgColumn,
  id: PgColumn,
  cursor: DecidedCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined;
  const at = new Date(cursor.decidedAt);
  return or(lt(decidedAt, at), and(eq(decidedAt, at), lt(id, cursor.id)));
}

export function toDecidedActor(
  actorType: string | null,
  actorId: string | null,
  name: string | null,
): ReviewDecisionActor {
  return {
    actorType: actorType === 'user' ? 'user' : 'agent',
    actorId: actorId ?? '',
    name: actorType === 'user' ? name : null,
  };
}

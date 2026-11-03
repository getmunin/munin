import type { ConditionOperator, JourneyCondition, Weekday } from '@getmunin/types';
import { inTimeWindow, localClock } from '../../common/send-window.ts';

export { inTimeWindow, localClock };

export interface ConditionFacts {
  contact: Record<string, unknown> | null;
  company: Record<string, unknown> | null;
  tags: readonly string[];
  context: Record<string, unknown>;
  events: readonly { name: string; occurredAt: Date }[];
  segments: ReadonlySet<string>;
  enteredAt: Date;
  now: Date;
  timezone: string;
}

export interface ConditionNeeds {
  events: Map<string, number>;
  segmentIds: Set<string>;
}

export function evaluateCondition(cond: JourneyCondition, facts: ConditionFacts): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, facts));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, facts));
  if ('not' in cond) return !evaluateCondition(cond.not, facts);
  if ('field' in cond) return compare(readField(cond.field, facts), cond.op, cond.value);
  if ('context' in cond) return compare(readPath(facts.context, cond.context), cond.op, cond.value);
  if ('tag' in cond) return facts.tags.includes(cond.tag) === (cond.present ?? true);
  if ('segment' in cond) return facts.segments.has(cond.segment) === (cond.member ?? true);
  if ('event' in cond) {
    const since =
      cond.since === 'entry'
        ? facts.enteredAt
        : cond.since
          ? new Date(facts.now.getTime() - cond.since.days * 86_400_000)
          : null;
    const count = facts.events.filter(
      (e) => e.name === cond.event && (!since || e.occurredAt >= since),
    ).length;
    const matched = count >= (cond.minCount ?? 1);
    return (cond.occurred ?? true) ? matched : !matched;
  }
  return matchesTime(cond.time, facts.now, facts.timezone);
}

export function collectConditionNeeds(
  cond: JourneyCondition,
  needs: ConditionNeeds = { events: new Map(), segmentIds: new Set() },
): ConditionNeeds {
  if ('all' in cond) cond.all.forEach((c) => collectConditionNeeds(c, needs));
  else if ('any' in cond) cond.any.forEach((c) => collectConditionNeeds(c, needs));
  else if ('not' in cond) collectConditionNeeds(cond.not, needs);
  else if ('event' in cond) needs.events.set(cond.event, Math.max(needs.events.get(cond.event) ?? 0, cond.minCount ?? 1));
  else if ('segment' in cond) needs.segmentIds.add(cond.segment);
  return needs;
}

function readField(path: string, facts: ConditionFacts): unknown {
  const [root, ...rest] = path.split('.');
  const source = root === 'company' ? facts.company : facts.contact;
  if (!source) return undefined;
  const [head, ...tail] = rest;
  if (head === 'custom_fields' || head === 'customFields') {
    return readPath((source.customFields ?? source.custom_fields ?? {}) as Record<string, unknown>, tail.join('.'));
  }
  return readPath(source, rest.join('.'));
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function compare(actual: unknown, op: ConditionOperator, expected: unknown): boolean {
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'not_exists':
      return actual === undefined || actual === null || actual === '';
    case 'eq':
      return looseEqual(actual, expected);
    case 'neq':
      return !looseEqual(actual, expected);
    case 'in':
      return Array.isArray(expected) && expected.some((e) => looseEqual(actual, e));
    case 'not_in':
      return !Array.isArray(expected) || !expected.some((e) => looseEqual(actual, e));
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => looseEqual(a, expected));
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        actual.toLowerCase().includes(expected.toLowerCase())
      );
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = orderable(actual);
      const b = orderable(expected);
      if (a === null || b === null) return false;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }
  }
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function orderable(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function matchesTime(
  spec: { days?: Weekday[]; between?: string },
  now: Date,
  timezone: string,
): boolean {
  const clock = localClock(now, timezone);
  if (spec.days && !spec.days.includes(clock.weekday)) return false;
  if (spec.between && !inTimeWindow(clock.minutes, spec.between)) return false;
  return true;
}

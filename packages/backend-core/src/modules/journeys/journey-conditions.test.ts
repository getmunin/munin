import { describe, expect, it } from 'vitest';
import {
  collectConditionNeeds,
  evaluateCondition,
  inTimeWindow,
  type ConditionFacts,
} from './journey-conditions.ts';

const now = new Date('2026-10-28T10:15:00Z');

function facts(overrides: Partial<ConditionFacts> = {}): ConditionFacts {
  return {
    contact: { title: 'CTO', email: 'kari@acme.test', customFields: { plan: 'pro', seats: '12' } },
    company: { name: 'Acme AS' },
    tags: ['trial'],
    context: { outcome: { interested: true } },
    events: [
      { name: 'teammate.invited', occurredAt: new Date('2026-10-27T09:00:00Z') },
      { name: 'report.exported', occurredAt: new Date('2026-09-01T09:00:00Z') },
    ],
    segments: new Set(['seg_vip']),
    enteredAt: new Date('2026-10-25T09:00:00Z'),
    now,
    timezone: 'Europe/Oslo',
    ...overrides,
  };
}

describe('journey conditions', () => {
  it('compares contact, custom and company fields', () => {
    expect(evaluateCondition({ field: 'contact.title', op: 'eq', value: 'cto' }, facts())).toBe(true);
    expect(evaluateCondition({ field: 'contact.custom_fields.plan', op: 'in', value: ['pro', 'team'] }, facts())).toBe(true);
    expect(evaluateCondition({ field: 'contact.custom_fields.seats', op: 'gte', value: 10 }, facts())).toBe(true);
    expect(evaluateCondition({ field: 'company.name', op: 'contains', value: 'acme' }, facts())).toBe(true);
    expect(evaluateCondition({ field: 'contact.phone', op: 'not_exists' }, facts())).toBe(true);
  });

  it('reads context, tags and segments', () => {
    expect(evaluateCondition({ context: 'outcome.interested', op: 'eq', value: true }, facts())).toBe(true);
    expect(evaluateCondition({ tag: 'trial' }, facts())).toBe(true);
    expect(evaluateCondition({ tag: 'customer', present: false }, facts())).toBe(true);
    expect(evaluateCondition({ segment: 'seg_vip', member: false }, facts())).toBe(false);
  });

  it('counts events since entry or within a number of days', () => {
    expect(evaluateCondition({ event: 'teammate.invited', since: 'entry' }, facts())).toBe(true);
    expect(evaluateCondition({ event: 'report.exported', since: 'entry' }, facts())).toBe(false);
    expect(evaluateCondition({ event: 'report.exported', since: { days: 90 } }, facts())).toBe(true);
    expect(evaluateCondition({ event: 'report.exported', occurred: false, since: { days: 14 } }, facts())).toBe(true);
    expect(evaluateCondition({ event: 'teammate.invited', minCount: 2 }, facts())).toBe(false);
  });

  it('combines conditions with all, any and not', () => {
    const cond = {
      all: [{ tag: 'trial' }, { any: [{ segment: 'seg_x' }, { not: { event: 'subscription.started' } }] }],
    };
    expect(evaluateCondition(cond, facts())).toBe(true);
  });

  it('evaluates time windows in the contact timezone, across midnight too', () => {
    expect(evaluateCondition({ time: { days: ['wed'], between: '09:00-17:00' } }, facts())).toBe(true);
    expect(evaluateCondition({ time: { between: '09:00-17:00' } }, facts({ timezone: 'America/New_York' }))).toBe(false);
    expect(inTimeWindow(23 * 60, '20:00-08:00')).toBe(true);
    expect(inTimeWindow(7 * 60, '20:00-08:00')).toBe(true);
    expect(inTimeWindow(12 * 60, '20:00-08:00')).toBe(false);
  });

  it('collects the events and segments a condition needs loaded, with the most occurrences any rule counts', () => {
    const needs = collectConditionNeeds({
      any: [{ event: 'trial.started' }, { event: 'trial.started', minCount: 3 }, { not: { segment: 'seg_vip' } }, { tag: 'x' }],
    });
    expect([...needs.events]).toEqual([['trial.started', 3]]);
    expect([...needs.segmentIds]).toEqual(['seg_vip']);
  });
});

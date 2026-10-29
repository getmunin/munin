import { describe, expect, it } from 'vitest';
import { layoutJourney } from './journey-graph';

const spec = {
  entry: { trigger: { type: 'manual' } },
  start: 'welcome',
  nodes: [
    { id: 'welcome', type: 'message', channel: 'email', content: { subject: 'Hei', body: 'Hei!' }, next: 'check' },
    {
      id: 'check',
      type: 'branch',
      rules: [{ if: { tag: 'trial' }, next: 'nudge' }],
      default: 'done',
    },
    { id: 'nudge', type: 'jump', to: 'welcome' },
    { id: 'done', type: 'exit' },
    { id: 'orphan', type: 'exit' },
  ],
};

describe('layoutJourney', () => {
  it('layers nodes by longest path, places unreachable nodes last, and marks only loops as back edges', () => {
    const layout = layoutJourney(spec)!;
    const y = Object.fromEntries(layout.nodes.map((n) => [n.node.id, n.y]));
    expect(y.welcome).toBeLessThan(y.check!);
    expect(y.check).toBeLessThan(y.nudge!);
    expect(y.nudge).toBe(y.done);
    expect(y.orphan).toBeGreaterThan(y.done!);
    const back = layout.edges.filter((e) => e.back).map((e) => `${e.from}->${e.to}`);
    expect(back).toEqual(['nudge->welcome']);
    expect(layout.edges.find((e) => e.from === 'check' && e.to === 'nudge')?.label).toBe('rule_1');
  });

  it('returns null for a spec that does not parse', () => {
    expect(layoutJourney({ start: 'x' })).toBeNull();
  });
});

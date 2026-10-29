import { describe, expect, it } from 'vitest';
import { JourneyNodeSchema } from '@getmunin/types';
import {
  NEW_STEP_KINDS,
  edgeFieldsFor,
  insertAfter,
  nodesWithErrors,
  parseNodeJson,
  setContent,
  setField,
  skeletonNode,
  suggestNodeId,
} from './draft-edit';

describe('draft editing helpers', () => {
  it('builds a schema-valid skeleton for every step a person can add', () => {
    for (const kind of NEW_STEP_KINDS) {
      expect(JourneyNodeSchema.safeParse(skeletonNode(kind, 'step')).success, kind).toBe(true);
    }
  });

  it('offers only the edges that step and channel can take', () => {
    expect(edgeFieldsFor(skeletonNode('email', 'a'))).toEqual(['next', 'onReply']);
    expect(edgeFieldsFor(skeletonNode('chat', 'a'))).toEqual(['next', 'onReply', 'onUnseen']);
    expect(edgeFieldsFor(skeletonNode('voice', 'a'))).toEqual(['next']);
    expect(edgeFieldsFor(skeletonNode('exit', 'a'))).toEqual([]);
  });

  it('inserts a new step between a step and the one it led to', () => {
    const anchor = { ...skeletonNode('email', 'welcome'), next: 'done' };
    expect(insertAfter(anchor, skeletonNode('wait', 'pause'))).toEqual({
      node: { ...skeletonNode('wait', 'pause'), next: 'done' },
      after: { nodeId: 'welcome', edge: 'next' },
    });
    expect(insertAfter(anchor, skeletonNode('exit', 'stop'))).toEqual({
      node: skeletonNode('exit', 'stop'),
      after: { nodeId: 'welcome', edge: 'next' },
    });
    expect(insertAfter(skeletonNode('exit', 'done'), skeletonNode('wait', 'pause'))).toEqual({ node: skeletonNode('wait', 'pause') });
  });

  it('clears a field set to nothing and keeps the rest of the step', () => {
    const node = { ...skeletonNode('email', 'a'), next: 'b', onReply: 'c' };
    expect(setField(node, 'onReply', '')).toEqual({ ...skeletonNode('email', 'a'), next: 'b' });
    expect(setContent(node, 'subject', '').content).toEqual({ body: 'Hi {{name}},' });
  });

  it('picks a free id and refuses JSON that renames or reshapes the step', () => {
    expect(suggestNodeId('wait', ['wait', 'wait_2'])).toBe('wait_3');
    expect(parseNodeJson('{"id":"a","type":"exit"}', 'a')).toEqual({ node: { id: 'a', type: 'exit' } });
    expect(parseNodeJson('{"id":"b","type":"exit"}', 'a')).toEqual({ error: 'id' });
    expect(parseNodeJson('[1]', 'a')).toEqual({ error: 'shape' });
    expect(parseNodeJson('{', 'a')).toEqual({ error: 'json' });
  });

  it('collects the steps that have validation errors', () => {
    const ids = nodesWithErrors({
      valid: false,
      errors: [
        { code: 'dangling_edge', nodeId: 'a', message: 'x' },
        { code: 'missing_goal', message: 'y' },
      ],
      warnings: [],
    });
    expect([...ids]).toEqual(['a']);
  });
});

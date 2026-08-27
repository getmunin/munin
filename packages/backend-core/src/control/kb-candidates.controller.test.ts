import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseDecisionQuery } from './kb-candidates.controller.ts';

describe('parseDecisionQuery', () => {
  it('passes nothing through when neither filter is given', () => {
    expect(parseDecisionQuery()).toEqual({});
  });

  it('accepts both outcomes', () => {
    expect(parseDecisionQuery('published')).toEqual({ outcome: 'published' });
    expect(parseDecisionQuery('dismissed')).toEqual({ outcome: 'dismissed' });
  });

  it('rejects an unknown outcome with a code-prefixed message instead of a 500', () => {
    expect(() => parseDecisionQuery('approved')).toThrow(BadRequestException);
    expect(() => parseDecisionQuery('approved')).toThrow(/kb_invalid: unknown outcome: approved/);
  });

  it('parses a numeric limit', () => {
    expect(parseDecisionQuery(undefined, '20')).toEqual({ limit: 20 });
    expect(parseDecisionQuery('published', '5')).toEqual({ outcome: 'published', limit: 5 });
  });

  it('rejects a limit that is not a positive integer', () => {
    for (const bad of ['0', '-1', '2.5', 'twenty', '']) {
      expect(() => parseDecisionQuery(undefined, bad)).toThrow(BadRequestException);
    }
  });
});
